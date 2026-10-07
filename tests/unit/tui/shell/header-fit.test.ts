import { describe, expect, test } from "bun:test";
import { fitHeaderLeft } from "../../../../src/tui/shell/header-fit";

const work = { key: "MOB-2841", title: "Add biometric authentication" };

describe("fitHeaderLeft", () => {
  test("keeps everything when it fits", () => {
    expect(fitHeaderLeft("Mobile Banking", work, 80)).toEqual({
      name: "Mobile Banking",
      title: "Add biometric authentication",
    });
    expect(fitHeaderLeft("Mobile Banking", null, 80)).toEqual({
      name: "Mobile Banking",
      title: null,
    });
  });

  test("the title gives way first", () => {
    // 14 name + 5 separator + 8 key + 1 space leaves 12 for the title.
    expect(fitHeaderLeft("Mobile Banking", work, 40)).toEqual({
      name: "Mobile Banking",
      title: "Add biometr…",
    });
  });

  test("then the title is dropped and the name shortened; the key is never cut", () => {
    expect(fitHeaderLeft("Mobile Banking", work, 30)).toEqual({
      name: "Mobile Banking",
      title: null,
    });
    expect(fitHeaderLeft("Mobile Banking", { key: "MOB-2841", title: null }, 20)).toEqual({
      name: "Mobile…",
      title: null,
    });
    expect(fitHeaderLeft("Mobile Banking", work, 10).name).toBe("Mob…");
  });

  test("without work only the name is shortened", () => {
    expect(fitHeaderLeft("Mobile Banking", null, 8)).toEqual({ name: "Mobile …", title: null });
    expect(fitHeaderLeft("Mobile Banking", null, -3).name).toBe("…");
  });
});
