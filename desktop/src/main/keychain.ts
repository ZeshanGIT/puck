import { dlopen, ptr, read, toArrayBuffer, type Pointer } from "bun:ffi";
import { Buffer } from "node:buffer";
import type { ClerkAccount } from "@puck/shared";

export interface DesktopAccount extends ClerkAccount {
  clientId?: string;
}

const service = Buffer.from("Puck Desktop");
const itemNotFound = -25300;

const { symbols } = dlopen("/System/Library/Frameworks/Security.framework/Security", {
  SecKeychainFindGenericPassword: {
    args: ["ptr", "u32", "ptr", "u32", "ptr", "ptr", "ptr", "ptr"],
    returns: "i32",
  },
  SecKeychainAddGenericPassword: {
    args: ["ptr", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"],
    returns: "i32",
  },
  SecKeychainItemModifyAttributesAndData: {
    args: ["ptr", "ptr", "u32", "ptr"],
    returns: "i32",
  },
  SecKeychainItemDelete: { args: ["ptr"], returns: "i32" },
  SecKeychainItemFreeContent: { args: ["ptr", "ptr"], returns: "i32" },
});
const { symbols: core } = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
  CFRelease: { args: ["ptr"], returns: "void" },
});

function check(status: number): void {
  if (status !== 0) throw new Error(`Puck could not access the macOS Keychain (${status}).`);
}

export class SessionKeychain {
  private readonly account: Buffer;

  constructor(frontendApi: string, convexUrl: string) {
    this.account = Buffer.from(JSON.stringify([frontendApi, convexUrl]));
  }

  read(): DesktopAccount | null {
    const length = Buffer.alloc(4);
    const output = Buffer.alloc(8);
    const status = symbols.SecKeychainFindGenericPassword(
      null, service.length, ptr(service), this.account.length, ptr(this.account),
      ptr(length), ptr(output), null,
    );
    if (status === itemNotFound) return null;
    check(status);
    const password = read.ptr(ptr(output), 0) as Pointer;
    try {
      const value: unknown = JSON.parse(Buffer.from(toArrayBuffer(password, 0, length.readUInt32LE())).toString("utf8"));
      if (!value || typeof value !== "object") return null;
      const account = value as Partial<DesktopAccount>;
      if (
        typeof account.sessionId === "string" && typeof account.userId === "string" &&
        typeof account.email === "string" &&
        typeof account.clientJwt === "string" &&
        (account.clientId === undefined || typeof account.clientId === "string")
      ) return account as DesktopAccount;
      return null;
    } finally {
      symbols.SecKeychainItemFreeContent(null, password);
    }
  }

  write(account: DesktopAccount): void {
    const password = Buffer.from(JSON.stringify(account));
    try {
      const item = this.findItem();
      if (item) {
        try {
          check(symbols.SecKeychainItemModifyAttributesAndData(item, null, password.length, ptr(password)));
        } finally {
          core.CFRelease(item);
        }
      } else {
        check(symbols.SecKeychainAddGenericPassword(
          null, service.length, ptr(service), this.account.length, ptr(this.account),
          password.length, ptr(password), null,
        ));
      }
    } finally {
      password.fill(0);
    }
  }

  clear(): void {
    const item = this.findItem();
    if (!item) return;
    try {
      const status = symbols.SecKeychainItemDelete(item);
      if (status !== itemNotFound) check(status);
    } finally {
      core.CFRelease(item);
    }
  }

  private findItem() {
    const output = Buffer.alloc(8);
    const status = symbols.SecKeychainFindGenericPassword(
      null, service.length, ptr(service), this.account.length, ptr(this.account), null, null, ptr(output),
    );
    if (status === itemNotFound) return null;
    check(status);
    return read.ptr(ptr(output), 0) as Pointer;
  }
}
