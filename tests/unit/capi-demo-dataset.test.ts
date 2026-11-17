import { describe, expect, it } from "vitest";
import { isMetaBusinessMessagingEvent } from "@/lib/meta/capi";
import { idDeDataset } from "@/lib/meta/dataset";
import {
  DEMO_EVENT,
  PURCHASE_EVENT,
  QUALIFIED_EVENT,
} from "@/server/attribution/conversions";

/** 077 — demo agendada como LeadSubmitted y el dataset traído de WhatsApp. */

describe("eventos que el CRM le manda a Meta", () => {
  it("los tres están en el catálogo cerrado de business_messaging", () => {
    for (const e of [QUALIFIED_EVENT, DEMO_EVENT, PURCHASE_EVENT]) {
      expect(isMetaBusinessMessagingEvent(e)).toBe(true);
    }
  });

  it("la demo agendada viaja como LeadSubmitted", () => {
    expect(DEMO_EVENT).toBe("LeadSubmitted");
  });
});

describe("idDeDataset", () => {
  it("lee la forma { data: [{ id }] } del GET", () => {
    expect(idDeDataset({ data: [{ id: "123", name: "x" }] })).toBe("123");
  });
  it("lee la forma { id } del POST", () => {
    expect(idDeDataset({ id: "456" })).toBe("456");
  });
  it("sin dataset devuelve null", () => {
    expect(idDeDataset({ data: [] })).toBeNull();
    expect(idDeDataset(null)).toBeNull();
    expect(idDeDataset({ id: "" })).toBeNull();
  });
});
