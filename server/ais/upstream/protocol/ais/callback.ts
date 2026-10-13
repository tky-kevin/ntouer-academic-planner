import { AisProtocolError } from "./protocol-error.js";

export type AisCallbackEnvelope = Readonly<{
  eventValidation: string;
  payload: string;
}>;

export function unwrapAisCallbackEnvelope(raw: string): AisCallbackEnvelope {
  if (raw.startsWith("e")) throw new AisProtocolError("callback_error");
  if (raw.startsWith("s"))
    return { eventValidation: "", payload: raw.slice(1) };

  const separator = raw.indexOf("|");
  if (separator <= 0) throw new AisProtocolError("invalid_callback_envelope");
  const lengthText = raw.slice(0, separator);
  if (!/^\d+$/u.test(lengthText))
    throw new AisProtocolError("invalid_callback_envelope");
  const validationLength = Number(lengthText);
  const payloadStart = separator + 1 + validationLength;
  if (!Number.isSafeInteger(validationLength) || payloadStart > raw.length) {
    throw new AisProtocolError("invalid_callback_length");
  }
  return {
    eventValidation: raw.slice(separator + 1, payloadStart),
    payload: raw.slice(payloadStart),
  };
}

export function unwrapAisCallback(raw: string): string {
  return unwrapAisCallbackEnvelope(raw).payload;
}

export function unwrapAisCallbackOrHtml(raw: string): string {
  if (
    /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html\b|<form\b|<div\b)/iu.test(
      raw,
    )
  ) {
    return raw;
  }
  return unwrapAisCallback(raw);
}
