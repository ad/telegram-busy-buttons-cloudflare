import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayName, hasVisibleText } from "../functions/utils/user.js";

describe("user: подпись пользователя", () => {
  it("имя и фамилия склеиваются", () => {
    assert.equal(displayName({ id: 1, first_name: "Ivan", last_name: "Petrov" }), "Ivan Petrov");
  });

  it("отсутствующая половина имени не оставляет лишних пробелов", () => {
    assert.equal(displayName({ id: 1, first_name: "Ivan" }), "Ivan");
    assert.equal(displayName({ id: 1, last_name: "Petrov" }), "Petrov");
  });

  it("имя из невидимых символов не считается именем", () => {
    assert.equal(displayName({ id: 1, first_name: "ㅤ", username: "nick" }), "@nick");
    assert.equal(displayName({ id: 1, first_name: " ​", username: "nick" }), "@nick");
  });

  it("без имени и username остаётся id", () => {
    assert.equal(displayName({ id: 42 }), "id42");
    assert.equal(displayName({ id: 42, first_name: "  " }), "id42");
  });

  it("отсутствие пользователя не роняет подпись", () => {
    assert.equal(displayName(null), "");
    assert.equal(displayName(undefined), "");
  });
});

describe("user: видимый текст", () => {
  it("различает пустое и непустое", () => {
    assert.equal(hasVisibleText("Ivan"), true);
    assert.equal(hasVisibleText(""), false);
    assert.equal(hasVisibleText("   "), false);
    assert.equal(hasVisibleText(null), false);
  });
});
