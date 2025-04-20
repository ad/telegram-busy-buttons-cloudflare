import { shortenUsername } from "../utils/utils.js";

export function onRequest(context) {
  if (context.params.path == `bot${context.env.BOT_TOKEN}`) {
    return bot(context);
  }

  return new Response("ok", { status: 200 });
}

async function bot(context) {
  const update = await context.request.json();
  console.log("update", update);

  if (context.env.BOT_DEBUG) {
    await messageLogger(context, update);
  }

  if (update.message && update.message.text) {
    if (
      update.message.text.startsWith(`/start`) ||
      update.message.text.startsWith(`/create`)
    ) {
      return await handlerMessage(context, update);
    }
  } else if (update.callback_query) {
    return await handlerCallback(context, update);
  }

  return new Response("ok", { status: 200 });
}

// this function should send text message with detailed information about the update    
async function messageLogger(context, update) {
  try {
    let text = "";

    if (update.message) {
      text = `Message from ${update.message.from.first_name} ${update.message.from.last_name} (${update.message.from.id})\n`;
      text += `Chat id: ${update.message.chat.id}\n`;
      text += `Text: ${update.message.text}\n`;
    }

    if (update.callback_query) {
      text = `Callback query from ${update.callback_query.from.first_name} ${update.callback_query.from.last_name} (${update.callback_query.from.id})\n`;
      text += `Chat id: ${update.callback_query.message.chat.id}\n`;
      text += `Text: ${update.callback_query.message.text}\n`;
      text += `Data: ${update.callback_query.data}\n`;
    }

    // edited message
    if (update.edited_message) {
      text = `Edited message from ${update.edited_message.from.first_name } ${update.edited_message.from.last_name} (${update.edited_message.from.id})\n`;
      text += `Chat id: ${update.edited_message.chat.id}\n`;
      text += `Text: ${update.edited_message.text}\n`;
    }

    if (text == "") {
      text = JSON.stringify(update);
    }

    let response = {
      method: "sendMessage",
      text: text,
      chat_id: context.env.BOT_ADMIN,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
    });
  } catch (error) {
    console.error("Error in messageLogger", error);
    return new Response("ok", { status: 200 });
  }
}

async function handlerCallback(ctx, update) {
  let callbackData;
  try {
    callbackData = JSON.parse(update.callback_query.data);
  } catch (error) {
    console.error("Error parsing callback data:", error);
    return new Response("Invalid callback data", { status: 400 });
  }

  // --- Новый обработчик ask ---
  if (callbackData.action === "ask" && callbackData.to) {
    // Отправить сообщение пользователю, который занял кнопку
    const from = update.callback_query.from;
    const askText = `Пользователь ${from.first_name || ""} ${from.last_name || ""} (${from.id}) просит освободить "${callbackData.target}" если уже не нужно.`;
    await reply(ctx, callbackData.to, false, askText);
    return await answerCbQuery(ctx, update.callback_query.id, "Запрос отправлен");
  }
  // --- конец нового обработчика ---

  if (!callbackData.c && callbackData.command) {
    callbackData.c = callbackData.command;
  }

  const isNotifyPressed = (callbackData.c && callbackData.c.startsWith("⚡"));
  let target = callbackData.c.replace(/^(free-|busy-)/, "");

  if (isNotifyPressed) {
    let notificationText = "...";
    if (callbackData.n) {
      const notifyState = callbackData.n.includes(
        update.callback_query.from.id
      )
        ? "disabled"
        : "enabled";
      notificationText = `${update.callback_query.from.first_name} ${update.callback_query.from.last_name} ${notifyState} notifications`;

      if (notifyState === "disabled") {
        callbackData.n = callbackData.n.filter(
          (id) => id !== update.callback_query.from.id
        );
      } else {
        callbackData.n.push(update.callback_query.from.id);
      }
    } else {
      callbackData.n = [update.callback_query.from.id];
    }

    // Переложить все кнопки в отдельные строки
    const flatButtons = (update.callback_query.message.reply_markup?.inline_keyboard || []).flat();
    const buttons = flatButtons.map((button) => {
      let cbd = JSON.parse(button.callback_data);
      if (cbd.c.startsWith("⚡")) {
        cbd.n = callbackData.n;
        button.text =
          "⚡" +
          (callbackData.n.length > 0
            ? " " + callbackData.n.length
            : "");
      }
      return [{
        text: button.text,
        callback_data: JSON.stringify(cbd),
      }];
    });

    await editMessageText(
      ctx,
      update.callback_query.message.chat.id,
      update.callback_query.message.message_id,
      update.callback_query.message.text,
      buttons
    );

    return await answerCbQuery(ctx, update.callback_query.id, notificationText);
  } else {
    let notifyData = [];

    const message = update.callback_query.message;
    let messageText = "";

    // Переложить все кнопки в отдельные строки и добавить ask только к занятым
    const flatButtons = (message.reply_markup?.inline_keyboard || []).flat();
    const buttons = [];
    for (const button of flatButtons) {
      // Безопасно получаем текст и callback_data
      const btnText = typeof button.text === "string" ? button.text : "";
      let cbd;
      try {
        cbd = typeof button.callback_data === "string" ? JSON.parse(button.callback_data) : {};
      } catch (e) {
        continue;
      }
      if (!cbd || (!cbd.c && !cbd.command)) {
        continue;
      }
      if (!cbd.c && cbd.command) {
        cbd.c = cbd.command;
      }

      let row = [];

      if (cbd.c === callbackData.c) {
        if (btnText.startsWith("🟢")) {
          button.text = btnText.replace("🟢", "🏗️");
        } else if (btnText.startsWith("🏗️")) {
          button.text = btnText.replace("🏗️", "🟢");
        }
        cbd.c = cbd.c.startsWith("busy-")
          ? cbd.c.replace("busy-", "free-")
          : cbd.c.replace("free-", "busy-");
        cbd.u = shortenUsername(
          cbd.c,
          update.callback_query.from.first_name,
          update.callback_query.from.last_name
        );
        target = button.text;
      }

      // Основная кнопка
      row.push({
        text: button.text,
        callback_data: JSON.stringify(cbd),
      });

      // Добавлять ask только к кнопкам, которые имеют статус 🏗️ и callback c начинается с free-
      // и только если кнопка сейчас действительно в состоянии "занято" (🏗️ и free-)
      let addAsk = (
        btnText.startsWith("🏗️") &&
        typeof cbd.c === "string" &&
        cbd.c.startsWith("free-") &&
        !(cbd.c === callbackData.c && btnText.startsWith("🟢"))
      );
      if (addAsk) {
        let busyUserId = (typeof cbd.u === "object" && cbd.u.id) ? cbd.u.id : update.callback_query.from.id;
        row.push({
          text: "🙇",
          callback_data: JSON.stringify({
            action: "ask",
            to: busyUserId,
            target: btnText.replace("🏗️", "").replace("🟢", "")
          }),
        });
      }

      // Добавляем строку только если она не состоит только из ask-кнопки
      if (row.length === 1 && row[0].text === "🙇") {
        continue;
      }
      buttons.push(row);
    }

    if (messageText == "") {
      try {
        messageText = buttons
          .flat()
          .filter((button) => (button.text && !button.text.startsWith("⚡") && button.text !== "🙇"))
          .map((button) => button.text)
          .join(" ");
      } catch (error) {
        console.error("Error parsing messageText", error);
        return await answerCbQuery(
          ctx,
          update.callback_query.id,
          `error ${error}`
        );
      }
    }

    await editMessageText(
      ctx,
      message.chat.id,
      message.message_id,
      messageText,
      buttons
    );

    if (notifyData && notifyData.length > 0) {
      for (const id of notifyData) {
        if (id === update.callback_query.from.id) {
          continue;
        }

        const notifyText = `${target} updated by ${shortenUsername(
          callbackData.c,
          update.callback_query.from.first_name,
          update.callback_query.from.last_name
        )}`;

        await reply(ctx, id, false, notifyText);
      }
    }

    return await answerCbQuery(
      ctx,
      update.callback_query.id,
      `${target} updated by ${update.callback_query.from.first_name} ${update.callback_query.from.last_name}`
    );
  }
}

async function handlerMessage(ctx, update) {
  if (update.message && update.message.text.startsWith("/create")) {
    const parts = update.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return await reply(
        ctx,
        update.message.chat.id,
        update.message.message_thread_id ?? false,
        "send command in format /create name1 name2 nameN"
      );
    }

    let messageText = "";

    // Каждая кнопка теперь в отдельном ряду
    let buttons = parts.slice(1).map((name) => {
      const callbackData = JSON.stringify({ c: `busy-${name}` });
      // Только одна кнопка (свободная) на старте, без ask
      return [{ text: `🟢${name}`, callback_data: callbackData }];
    });

    if (buttons.length > 0) {
      messageText = buttons.map((row) => row[0].text).join(" ");
    }

    const notifyButton = [{
      text: "⚡",
      callback_data: JSON.stringify({ c: "⚡", n: [] }),
    }];

    buttons.push(notifyButton);

    console.log("buttons", messageText, buttons);

    return await reply(
      ctx,
      update.message.chat.id,
      update.message.message_thread_id ?? false,
      messageText,
      buttons
    );
  }

  return await reply(
    ctx,
    update.message.chat.id,
    update.message.message_thread_id ?? false,
    "send command in format /create name1 name2 nameN"
  );
}

async function editMessageText(ctx, chatId, messageId, text, buttons) {
  let request = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
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

  if (response.status === 200) {
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

  if (response.status === 200) {
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

  if (response.status === 200) {
    return new Response(await response.text(), { status: 200 });
  }

  console.log("request", request);

  return new Response(await response.text(), { status: 200 });
}
