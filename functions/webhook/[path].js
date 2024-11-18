import {
  toLatin
} from "../utils/utils.js";

export function onRequest(context) {
  if (context.params.path == `bot${context.env.BOT_TOKEN}`) {
      return bot(context);
  }

  return new Response("ok", { status: 200 });
} 

async function bot(context) {
  const update = await context.request.json();
  console.log("update", update);

  if (update.message && update.message.text) {
    if (update.message.text.startsWith(`/start`) || update.message.text.startsWith(`/create`)) {
      return await handler(context, update);
    }
  } else if (update.callback_query) {
    return await handler(context, update);
  }

  let response = {
    method: "sendMessage",
    text: JSON.stringify(update),
    chat_id: 71557,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
  });
}

async function showFlashMessage(context, callbackQueryID, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${context.env.BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryID,
        text: text,
      }),
    }
  );

  return new Response(JSON.stringify(response), { status: 200 });
}

// function minifyJson(input) {
//   try {
//     return JSON.stringify(JSON.parse(input));
//   } catch (error) {
//     return input;
//   }
// }

function checkStringLimit(input, limit) {
  return input.length <= limit;
}

function shortenUsername(command, name, lastname) {
  // 18 chars is allocated to struct {"c": "", "u": ""}

  name = toLatin(name);
  lastname = toLatin(lastname);

  const limit = 64 - 18 - command.length;

  if (limit <= 0) {
    return "";
  }

  if (name.length <= 0 && lastname.length <= 0) {
    return "";
  }

  if (name.length + lastname.length < limit) {
    return name + " " + lastname;
  }

  if (name.length > 0) {
    if (name.length < limit - 3) {
      return name + " " + lastname.charAt(0) + ".";
    }

    if (name.length > limit) {
      if (name.length >= limit) {
        return name.substring(0, limit);
      }
    }

    if (lastname.length > limit) {
      return lastname.substring(0, limit);
    }
  }

  return "";
}

async function handler(ctx, update) {
  if (update.callback_query) {
    const callbackData = JSON.parse(update.callback_query.data);
    const isNotifyPressed = callbackData.command.startsWith("⚡");
    const target = callbackData.command.replace(/^(free-|busy-)/, "");

    let notificationText = `${target} updated by ${update.callback_query.from.first_name} ${update.callback_query.from.last_name}`;

    if (isNotifyPressed) {
      const notifyState = callbackData.notify.includes(update.callback_query.from.id) ? "disabled" : "enabled";
      notificationText = `${update.callback_query.from.first_name} ${update.callback_query.from.last_name} ${notifyState} notifications`;
    }

    const message = update.callback_query.message;
    const buttons = message.reply_markup.inline_keyboard.flatMap(subitems => {
      return subitems.map(subitem => {
        const cbd = JSON.parse(subitem.callback_data);
        if (cbd.command === callbackData.command) {
          cbd.user = shortenUsername(cbd.command, update.callback_query.from.first_name, update.callback_query.from.last_name);
          cbd.command = cbd.command.startsWith("busy-") ? cbd.command.replace("busy-", "free-") : cbd.command.replace("free-", "busy-");
        }
        return {
          text: subitem.text,
          callback_data: JSON.stringify(cbd)
        };
      });
    });

    let messageText = buttons.map(button => button.text).join(" ");

    const notifyButton = {
      text: "⚡",
      callback_data: JSON.stringify({ command: "⚡", notify: callbackData.notify })
    };

    buttons.push(notifyButton);

    await editMessageText(
      ctx,
      message.chat.id,
      message.message_id,
      messageText,
      { reply_markup: { inline_keyboard: buttons } }
    );

    return await answerCbQuery(ctx, update.callback_query.id, notificationText);
  }

  if (update.message && update.message.text.startsWith("/create")) {
    const parts = update.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return await reply(ctx, update.message.chat.id, "you must send command in format /create name1 name2 nameN");
    }

    let messageText = "";

    const buttons = parts.slice(1).map(name => {
      const callbackData = JSON.stringify({ command: `busy-${name}` });
      return { text: `🟢${name}`, callback_data: callbackData };
    });

    if (buttons.length > 0) {
			messageText = buttons.map(button => button.text).join(" ")
		}

    const notifyButton = { text: "⚡", callback_data: JSON.stringify({ command: "⚡" }) };
    // todo: add button to a separate row
    buttons.push(notifyButton);

    return await reply(ctx, update.message.chat.id, messageText, buttons);
  }
}

async function editMessageText(ctx, chatId, messageId, text, buttons) {
  const response = await fetch(
    `https://api.telegram.org/bot${ctx.env.BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        reply_markup: {
          inline_keyboard: buttons,
        },
      }),
    }
  );

  return new Response(JSON.stringify(response), { status: 200 });
}

async function reply(context, chatId, text, buttons) {
  let request = {
    chat_id: chatId,
    text: text,
  };

  if (buttons) {
    request.reply_markup = {
      inline_keyboard: [
        buttons
      ],
    };
  }

  console.log("request", request); 

  const response = await fetch(
    `https://api.telegram.org/bot${context.env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  return new Response(JSON.stringify(response), { status: 200 });
}

async function answerCbQuery(context, callbackQueryID, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${context.env.BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryID,
        text: text,
      }),
    }
  );

  return new Response(JSON.stringify(response), { status: 200 });
}