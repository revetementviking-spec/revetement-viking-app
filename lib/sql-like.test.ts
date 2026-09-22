import { describe, it, expect } from "vitest";
import { echapperLike } from "./sql-like";

describe("echapperLike — les jokers saisis deviennent littéraux", () => {
  it("échappe % _ et la barre oblique inverse", () => {
    expect(echapperLike("100%")).toBe("100\\%");
    expect(echapperLike("a_b")).toBe("a\\_b");
    expect(echapperLike("c:\\x")).toBe("c:\\\\x");
    expect(echapperLike("%_%")).toBe("\\%\\_\\%");
  });

  it("laisse un terme ordinaire intact", () => {
    expect(echapperLike("Julie Tremblay")).toBe("Julie Tremblay");
    expect(echapperLike("")).toBe("");
  });
});
