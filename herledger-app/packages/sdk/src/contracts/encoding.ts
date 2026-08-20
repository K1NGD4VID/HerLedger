import { xdr, Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { ContractError, ContractErrorCode } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Centralized XDR encoding/decoding utilities for Soroban contract calls.
// Never construct raw XDR strings manually.
// ---------------------------------------------------------------------------

/**
 * Encode a hex string (32 bytes) as a Soroban Bytes ScVal.
 */
export function encodeBytes32(hex: string): xdr.ScVal {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new ContractError(
      ContractErrorCode.ENCODE_ERROR,
      `Expected 32-byte hex string, got ${bytes.length} bytes`
    );
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/**
 * Encode a Stellar address string as a Soroban Address ScVal.
 */
export function encodeAddress(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/**
 * Encode a bigint as an i128 ScVal.
 */
export function encodeI128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

/**
 * Encode a boolean as a bool ScVal.
 */
export function encodeBool(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

/**
 * Encode a u32 as a uint32 ScVal.
 */
export function encodeU32(value: number): xdr.ScVal {
  return xdr.ScVal.scvU32(value);
}

/**
 * Decode a Bytes ScVal to a hex string.
 */
export function decodeBytes32(val: xdr.ScVal): string {
  const bytes = val.bytes();
  return Buffer.from(bytes).toString("hex");
}

/**
 * Decode an Address ScVal to a Stellar address string.
 */
export function decodeAddress(val: xdr.ScVal): string {
  return Address.fromScVal(val).toString();
}

/**
 * Decode an i128 ScVal to bigint.
 * Uses scValToNative which returns a BigInt for i128/u128.
 */
export function decodeI128(val: xdr.ScVal): bigint {
  const native = scValToNative(val);
  if (typeof native === "bigint") return native;
  return BigInt(String(native));
}

/**
 * Decode a u64 ScVal to bigint.
 */
export function decodeU64(val: xdr.ScVal): bigint {
  const native = scValToNative(val);
  if (typeof native === "bigint") return native;
  return BigInt(String(native));
}

/**
 * Decode a bool ScVal.
 */
export function decodeBool(val: xdr.ScVal): boolean {
  return val.b();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new ContractError(
      ContractErrorCode.ENCODE_ERROR,
      `Invalid hex string length: ${clean.length}`
    );
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    if (isNaN(byte)) {
      throw new ContractError(
        ContractErrorCode.ENCODE_ERROR,
        `Invalid hex character at position ${i}`
      );
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}
