import { describe, it, expect } from "vitest";
import { selectWriteService } from "../../src/remote/writeService.js";
import { azdoWriteService } from "../../src/remote/azdoWriteService.js";

describe("selectWriteService", () => {
  it("selects azdo only for an explicit azdo remote", () => {
    expect(selectWriteService({ remoteType: "azdo" })).toBe(azdoWriteService);
  });

  it("selects GitHub for gh and for an absent remoteType", () => {
    expect(selectWriteService({ remoteType: "gh" })).not.toBe(azdoWriteService);
    expect(selectWriteService({})).not.toBe(azdoWriteService);
  });
});
