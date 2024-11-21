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
      return await handlerMessage(context, update);
    }
  } else if (update.callback_query) {
    return await handlerCallback(context, update);
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

function shortenUsername(command, name, lastname) {
  // 18 chars is allocated to struct {"c": "", "u": ""}

  name = toLatin(name);
  lastname = toLatin(lastname);

  const limit = 64 - 33 - JSON.stringify(command).length;

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

async function handlerCallback(ctx, update) {
  // showFlashMessage(ctx, update.callback_query.id, "...");

  let callbackData;
  try {
    callbackData = JSON.parse(update.callback_query.data);
  } catch (error) {
    console.error("Error parsing callback data:", error);
    return new Response("Invalid callback data", { status: 400 });
  }

  const isNotifyPressed = callbackData.command.startsWith("⚡");
  let target = callbackData.command.replace(/^(free-|busy-)/, "");

  if (isNotifyPressed) {
    let notificationText = '...';
    if (callbackData.notify) {
      const notifyState = callbackData.notify.includes(update.callback_query.from.id) ? "disabled" : "enabled";
      notificationText = `${update.callback_query.from.first_name} ${update.callback_query.from.last_name} ${notifyState} notifications`;

      if (notifyState === "disabled") {
        callbackData.notify = callbackData.notify.filter(id => id !== update.callback_query.from.id);
      } else {
        callbackData.notify.push(update.callback_query.from.id);
      }
    } else {
      callbackData.notify = [update.callback_query.from.id];
    }

    const buttons = update.callback_query.message.reply_markup.inline_keyboard.map(row => {
      return row.map(button => {
        let cbd = JSON.parse(button.callback_data);
        if (cbd.command.startsWith("⚡")) {
          cbd.notify = callbackData.notify
          button.text = "⚡" + (callbackData.notify.length > 0 ? " " + callbackData.notify.length : "");
        }

        return {
          text: button.text,
          callback_data: JSON.stringify(cbd)
        };
      });
    });

    await editMessageText(ctx, update.callback_query.message.chat.id, update.callback_query.message.message_id, update.callback_query.message.text, buttons);

    return await answerCbQuery(ctx, update.callback_query.id, notificationText);
  } else {
    let notifyData = [];

    const message = update.callback_query.message;
    let messageText = "";
    const buttons = message.reply_markup.inline_keyboard.map(row => {
      return row.map(button => {
        let cbd = JSON.parse(button.callback_data);
        if (cbd.command === callbackData.command) {
          button.text = button.text.startsWith("🟢") ? button.text.replace("🟢", "🏗️") : button.text.replace("🏗️", "🟢");
          cbd.command = cbd.command.startsWith("busy-") ? cbd.command.replace("busy-", "free-") : cbd.command.replace("free-", "busy-");
          cbd.user = shortenUsername(cbd.command, update.callback_query.from.first_name, update.callback_query.from.last_name);
          target = button.text;
        }

        if (button.text.startsWith("⚡")) {
          notifyData = cbd.notify;
        } else {
          if (cbd.user && cbd.user != "" && cbd.command.startsWith("free-")) {
            messageText += button.text + " (" + cbd.user + ") ";
          } else {
            messageText += button.text + " ";
          }
        }

        // console.log(JSON.stringify(cbd), JSON.stringify(JSON.stringify(cbd)).length);

        return {
          text: button.text,
          callback_data: JSON.stringify(cbd)
        };
      });
    });

    if (messageText == "") {
      messageText = buttons.flat().filter(button => !button.text.startsWith("⚡")).map(button => button.text).join(" ");
    }

    await editMessageText(ctx, message.chat.id, message.message_id, messageText, buttons);

    if (notifyData.length > 0) {
      notifyData.forEach(async id => {
        if (id === update.callback_query.from.id) {
          return;
        }

        const notifyText = `${target} updated by ${shortenUsername(callbackData.command, update.callback_query.from.first_name, update.callback_query.from.last_name)}`;


        await reply(ctx, id, false, notifyText);
      });
    }

    return await answerCbQuery(ctx, update.callback_query.id, `${target} updated by ${update.callback_query.from.first_name} ${update.callback_query.from.last_name}`);
  }
}

async function handlerMessage(ctx, update) {
  if (update.message && update.message.text.startsWith("/create")) {
    const parts = update.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return await reply(ctx, update.message.chat.id, update.message.message_thread_id ?? false, "send command in format /create name1 name2 nameN");
    }

    let messageText = "";

    let buttons = parts.slice(1).map(name => {
      const callbackData = JSON.stringify({ command: `busy-${name}` });
      return { text: `🟢${name}`, callback_data: callbackData };
    });

    if (buttons.length > 0) {
      messageText = buttons.map(button => button.text).join(" ");
    }

    const notifyButton = { text: "⚡", callback_data: JSON.stringify({ command: "⚡", notify: [] }) };

    // Add notifyButton to a separate row
    buttons = [buttons, [notifyButton]];

    return await reply(ctx, update.message.chat.id, update.message.message_thread_id ?? false, messageText, buttons);
  }

  return await reply(ctx, update.message.chat.id, update.message.message_thread_id ?? false, "send command in format /create name1 name2 nameN");
}

async function editMessageText(ctx, chatId, messageId, text, buttons) {
  let request = {
    chat_id: chatId,
    message_id: messageId,
    text: text
  };

  if (buttons) {
    request.reply_markup = {
      inline_keyboard: buttons,
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${ctx.env.BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  
  if (request.status === 200) {
    return new Response(await response.text(), { status: 200 });
  }
  
  console.log("request", JSON.stringify(request));

  return new Response(await response.text(), { status: 200 });
}

async function reply(context, chatId, message_thread_id, text, buttons) {
  let request = {
    chat_id: chatId,
    text: text,
  };

  if (message_thread_id) {
    request.message_thread_id = message_thread_id;
  }

  if (buttons) {
    request.reply_markup = {
      inline_keyboard: buttons,
    };
  }
  
  const response = await fetch(
    `https://api.telegram.org/bot${context.env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  
  if (request.status === 200) {
    return new Response(await response.text(), { status: 200 });
  }
  
  console.log("request", JSON.stringify(request));

  return new Response(await response.text(), { status: 200 });
}

async function answerCbQuery(context, callbackQueryID, text) {
  let request = {
    callback_query_id: callbackQueryID,
    text: text,
  };

  const response = await fetch(
    `https://api.telegram.org/bot${context.env.BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  
  if (request.status === 200) {
    return new Response(await response.text(), { status: 200 });
  }
  
  console.log("request", request);

  return new Response(await response.text(), { status: 200 });
}