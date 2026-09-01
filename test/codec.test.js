import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTION,
  CALLBACK_DATA_LIMIT,
  MAX_RESOURCE_NAME_BYTES,
  byteLength,
  decodeCallbackData,
  encodeAsk,
  encodeNotify,
  encodeResource,
  fitsCallbackData,
} from "../functions/utils/codec.js";

describe("codec: компактный формат", () => {
  it("свободный ресурс переживает round trip", () => {
    const payload = { action: ACTION.RESOURCE, name: "prod", busy: false, holder: null };
    assert.deepEqual(decodeCallbackData(encodeResource(payload)), payload);
  });

  it("занятый ресурс сохраняет держателя", () => {
    const payload = { action: ACTION.RESOURCE, name: "prod", busy: true, holder: 123456789 };
    assert.equal(encodeResource(payload), "b|21i3v9|prod");
    assert.deepEqual(decodeCallbackData(encodeResource(payload)), payload);
  });

  it("занятый ресурс без известного держателя остаётся занятым", () => {
    const payload = { action: ACTION.RESOURCE, name: "prod", busy: true, holder: null };
    assert.deepEqual(decodeCallbackData(encodeResource(payload)), payload);
  });

  it("просьба освободить переживает round trip", () => {
    const payload = { action: ACTION.ASK, name: "prod", holder: 42 };
    assert.deepEqual(decodeCallbackData(encodeAsk(payload)), payload);
  });

  it("список подписчиков переживает round trip", () => {
    assert.deepEqual(decodeCallbackData(encodeNotify([1, 2, 3])), {
      action: ACTION.NOTIFY,
      subscribers: [1, 2, 3],
    });
    assert.deepEqual(decodeCallbackData(encodeNotify([])), { action: ACTION.NOTIFY, subscribers: [] });
  });

  it("разделитель внутри имени не ломает разбор", () => {
    for (const name of ["a|b", "a|b|c", "a.b"]) {
      assert.deepEqual(decodeCallbackData(encodeResource({ name, busy: false, holder: null })).name, name);
      assert.deepEqual(decodeCallbackData(encodeResource({ name, busy: true, holder: 7 })).name, name);
      assert.deepEqual(decodeCallbackData(encodeAsk({ name, holder: 7 })).name, name);
    }
  });

  it("мусор не разбирается", () => {
    for (const raw of ["", null, undefined, "{", "x|y", "b||", "f|", "a||prod", "a|ZZ|prod", "a|7|", 42]) {
      assert.equal(decodeCallbackData(raw), null, `ожидался null для ${JSON.stringify(raw)}`);
    }
  });
});

describe("codec: старый JSON-формат", () => {
  it('"busy-" означает, что ресурс свободен', () => {
    assert.deepEqual(decodeCallbackData('{"c":"busy-prod"}'), {
      action: ACTION.RESOURCE,
      name: "prod",
      busy: false,
      holder: null,
    });
  });

  it('"free-" означает, что ресурс занят', () => {
    assert.deepEqual(decodeCallbackData('{"c":"free-prod","u":123}'), {
      action: ACTION.RESOURCE,
      name: "prod",
      busy: true,
      holder: 123,
    });
  });

  it("занятость сохраняется, даже если id держателя в старой кнопке не было", () => {
    assert.deepEqual(decodeCallbackData('{"c":"free-prod"}'), {
      action: ACTION.RESOURCE,
      name: "prod",
      busy: true,
      holder: null,
    });
  });

  it("читается самый старый ключ command", () => {
    assert.deepEqual(decodeCallbackData('{"command":"busy-prod"}'), {
      action: ACTION.RESOURCE,
      name: "prod",
      busy: false,
      holder: null,
    });
  });

  it("читается кнопка уведомлений", () => {
    assert.deepEqual(decodeCallbackData('{"c":"⚡","n":[1,2]}'), {
      action: ACTION.NOTIFY,
      subscribers: [1, 2],
    });
    assert.deepEqual(decodeCallbackData('{"c":"⚡","n":[]}'), { action: ACTION.NOTIFY, subscribers: [] });
  });

  it("читается кнопка просьбы, в том числе с id строкой", () => {
    assert.deepEqual(decodeCallbackData('{"a":"ask","t":"123","b":"prod"}'), {
      action: ACTION.ASK,
      name: "prod",
      holder: 123,
    });
  });
});

describe("codec: лимит в 64 байта", () => {
  it("имя максимальной длины ещё влезает вместе с держателем", () => {
    const name = "x".repeat(MAX_RESOURCE_NAME_BYTES);
    const holder = 9999999999;
    assert.ok(fitsCallbackData(encodeResource({ name, busy: true, holder })));
    assert.ok(fitsCallbackData(encodeAsk({ name, holder })));
  });

  it("байты считаются в utf-8, а не в символах", () => {
    assert.equal(byteLength("прод"), 8);
    assert.ok(byteLength("п".repeat(MAX_RESOURCE_NAME_BYTES)) > MAX_RESOURCE_NAME_BYTES);
  });

  it("компактный формат вмещает больше подписчиков, чем старый JSON", () => {
    const ids = [111111111, 222222222, 333333333, 444444444, 555555555];
    assert.ok(byteLength(JSON.stringify({ c: "⚡", n: ids })) > CALLBACK_DATA_LIMIT);
    assert.ok(fitsCallbackData(encodeNotify(ids)));
  });
});
