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
    try {
      return await handlerCallback(context, update);
    } catch (error) {
      let response = {
        method: "sendMessage",
        text: error.message,
        chat_id: context.env.BOT_ADMIN,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
      });
    }
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

function getUserDisplay(user) {
  if (user.first_name || user.last_name) {
    return `${user.first_name || ""} ${user.last_name || ""}`.trim();
  }
  if (user.username) {
    return '@' + user.username;
  }
  return 'id' + user.id;
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
  if (callbackData.a === "ask" && callbackData.t) {
    // Отправить сообщение пользователю, который занял кнопку
    const from = update.callback_query.from;
    const targetId = typeof callbackData.t === "string" ? Number(callbackData.t) : callbackData.t;
    if (targetId === from.id) {
      const funnyText = "Ты только что попросил себя освободить. Попробуй договориться с зеркалом.";
      return await answerCbQuery(ctx, update.callback_query.id, funnyText);
    }
    const fromDisplay = getUserDisplay(from);
    const askText = `Пользователь ${fromDisplay} просит освободить "${callbackData.b}" если уже не нужно.`;
    await reply(ctx, targetId, false, askText);
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
      notificationText = `Notifications ${notifyState}`;

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

    // Перебираем строки и кнопки, меняем только текст нужной кнопки
    const buttons = (update.callback_query.message.reply_markup?.inline_keyboard || []).map(row =>
      row.map(button => {
        let cbd = JSON.parse(button.callback_data);
        if (cbd.c && cbd.c.startsWith("⚡")) {
          cbd.n = callbackData.n;
          return {
            text: "⚡" + (callbackData.n.length > 0 ? " " + callbackData.n.length : ""),
            callback_data: JSON.stringify(cbd),
          };
        }
        return button;
      })
    );

    let editMessageResult = await editMessageText(
      ctx,
      update.callback_query.message.chat.id,
      update.callback_query.message.message_id,
      update.callback_query.message.text,
      buttons
    );

    try {
      console.log("editMessageResult", await editMessageResult.json());
    } catch (error) {
      console.error("Error parsing editMessageResult", error);
    }

    return await answerCbQuery(ctx, update.callback_query.id, notificationText);
  } else {
    let notifyData = [];
    let notifyTargetName = callbackData.c.replace(/^(free-|busy-)/, "");
    let notifyAction = "обновляет";

    const message = update.callback_query.message;
    let messageText = "";

    // Переложить все кнопки в отдельные строки и добавить ask только к занятым
    const flatButtons = (message.reply_markup?.inline_keyboard || []).flat();
    for (const button of flatButtons) {
      if (!button || typeof button.callback_data !== "string") {
        continue;
      }
      let cbd;
      try {
        cbd = JSON.parse(button.callback_data);
      } catch (e) {
        continue;
      }
      if (cbd && typeof cbd.c === "string" && cbd.c.startsWith("⚡")) {
        if (Array.isArray(cbd.n)) {
          notifyData = cbd.n;
        }
      }
    }
    const buttons = [];
    for (const button of flatButtons) {
      // Гарантируем, что button определён и имеет text и callback_data
      if (!button || typeof button.text !== "string" || typeof button.callback_data !== "string") {
        continue;
      }
      const btnText = button.text;
      let cbd;
      try {
        cbd = JSON.parse(button.callback_data);
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

      let willBeBusyFree = false;
      // Убираем иконки из текста кнопки (для обратной совместимости со старыми кнопками)
      let newText = btnText.replace(/^[🟢🏗️]\s*/, "").trim();
      let newCbd = { ...cbd };
      const user = update.callback_query.from;

      if (cbd.c === callbackData.c) {
        if (cbd.c.startsWith("busy-")) {
          // Свободная → занятая
          const buttonName = cbd.c.replace("busy-", "");
          const userDisplay = getUserDisplay(user);
          newText = userDisplay ? `${buttonName} ${userDisplay}` : buttonName;
          newCbd.c = cbd.c.replace("busy-", "free-");
          newCbd.u = user.id;
          notifyAction = "занимает";
          willBeBusyFree = true;
        } else if (cbd.c.startsWith("free-")) {
          // Занятая → свободная
          const buttonName = cbd.c.replace("free-", "");
          newText = buttonName;
          newCbd.c = cbd.c.replace("free-", "busy-");
          delete newCbd.u;
          notifyAction = "освобождает";
          willBeBusyFree = false;
        }
        const buttonName = newCbd.c.replace(/^(free-|busy-)/, "");
        target = buttonName;
        notifyTargetName = buttonName;
      } else {
        willBeBusyFree = typeof cbd.c === "string" && cbd.c.startsWith("free-");
      }

      const finalCbd = cbd.c === callbackData.c ? newCbd : cbd;
      const mainButtonText = cbd.c === callbackData.c ? newText : newText;
      const mainButton = {
        text: mainButtonText,
        callback_data: JSON.stringify(finalCbd),
      };

      if (finalCbd.c && finalCbd.c.startsWith("free-")) {
        mainButton.style = "danger"; // красная = занята
      } else if (finalCbd.c && !finalCbd.c.startsWith("⚡")) {
        mainButton.style = "success"; // зелёная = свободна
      }

      row.push(mainButton);

      // Добавлять ask только если кнопка после этого действия в состоянии занята
      if (willBeBusyFree) {
        let busyUserId = (cbd.c === callbackData.c ? newCbd.u : cbd.u);
        if (typeof busyUserId === "string" && /^[0-9]+$/.test(busyUserId)) {
          busyUserId = Number(busyUserId);
        }
        if (typeof busyUserId === "number") {
          row.push({
            text: "🙇",
            style: "primary",
            callback_data: JSON.stringify({
              a: "ask",
              t: busyUserId,
              b: finalCbd.c.replace(/^(free-|busy-)/, "")
            }),
          });
        }
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
          .map((button) => {
            try {
              const bCbd = JSON.parse(button.callback_data);
              const isBusy = bCbd.c && bCbd.c.startsWith("free-");
              const name = bCbd.c ? bCbd.c.replace(/^(free-|busy-)/, "") : button.text;
              return (isBusy ? "🏗️" : "🟢") + name;
            } catch (e) {
              return button.text;
            }
          })
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

    let editMessageResult = await editMessageText(
      ctx,
      message.chat.id,
      message.message_id,
      messageText,
      buttons
    );

    try {
      console.log("editMessageResult", await editMessageResult.json());
    } catch (error) {
      console.error("Error parsing editMessageResult", error);
    }

    if (notifyData && notifyData.length > 0) {
      for (const id of notifyData) {
        if (id === update.callback_query.from.id) {
          continue;
        }

        const userDisplayUpdater = getUserDisplay(update.callback_query.from);
        const notifyText = `${userDisplayUpdater} ${notifyAction} ${notifyTargetName}`;

        console.log("notify", {
          to: id,
          from: update.callback_query.from.id,
          text: notifyText,
        });

        await reply(ctx, id, false, notifyText);
      }
    }

    return await answerCbQuery(
      ctx,
      update.callback_query.id,
      `${target} updated`
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
      return [{ text: name, callback_data: callbackData, style: "success" }];
    });

    if (buttons.length > 0) {
      messageText = buttons.map((row) => `🟢${row[0].text}`).join(" ");
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

  console.log("request", JSON.stringify(request));

  const response = await fetch(
    `https://api.telegram.org/bot${ctx.env.BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  const responseText = await response.text();
  if (response.status !== 200) {
    console.error("Error editing message:", responseText);
  }
  return new Response(responseText, { status: 200 });
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
