import "./helpers/env.js";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { installFetchStub } from "./helpers/fetchStub.js";
import { login } from "../src/services/authService.js";
import { loginSchema, signupSchema } from "../src/validators/authSchemas.js";

const PASSWORD = "correct horse";
const hash = bcrypt.hashSync(PASSWORD, 4);

let stub;
beforeEach(() => {
  stub = installFetchStub();
});
afterEach(() => {
  stub.restore();
});

function userRow(whatsapp_number) {
  return { id: "u1", name: "Ada", whatsapp_number, password_hash: hash, created_at: "2026-01-01" };
}

describe("login with legacy phone formats", () => {
  test("a stored number that can't be normalized still logs in by exact match", async () => {
    const legacy = "4478123456"; // foreign number saved without "+"
    stub.on({ table: "users", method: "GET" }, [userRow(legacy)]);

    const input = loginSchema.parse({ whatsapp_number: legacy, password: PASSWORD });
    const user = await login(input);

    assert.equal(user.id, "u1");
    assert.equal(user.password_hash, undefined);
    const [q] = stub.callsTo({ table: "users", method: "GET" });
    assert.equal(q.url.searchParams.get("whatsapp_number"), `in.(${legacy})`);
    assert.equal(stub.callsTo({ table: "users", method: "PATCH" }).length, 0, "no rewrite for un-normalizable numbers");
  });

  test("a local-format Nigerian row is found via +234 input and upgraded", async () => {
    stub.on({ table: "users", method: "GET" }, [userRow("08031234567")]);
    stub.on({ table: "users", method: "PATCH" }, [{ whatsapp_number: "+2348031234567" }]);

    const user = await login(loginSchema.parse({ whatsapp_number: "+234 803 123 4567", password: PASSWORD }));

    assert.equal(user.whatsapp_number, "+2348031234567");
    assert.equal(stub.callsTo({ table: "users", method: "PATCH" }).length, 1);
  });

  test("wrong password is rejected", async () => {
    stub.on({ table: "users", method: "GET" }, [userRow("4478123456")]);
    await assert.rejects(login({ whatsapp_number: "4478123456", password: "nope" }), { statusCode: 401 });
  });
});

describe("signup still requires a valid number", () => {
  test("garbage and un-prefixed foreign numbers are rejected", () => {
    for (const whatsapp_number of ["hello-world", "4478123456"]) {
      assert.equal(signupSchema.safeParse({ name: "A", whatsapp_number, password: "12345678" }).success, false, whatsapp_number);
    }
  });
});
