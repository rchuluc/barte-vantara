"use client";

import { datadogRum } from "@datadog/browser-rum";

const applicationId = process.env.NEXT_PUBLIC_DD_APPLICATION_ID || "";
const clientToken = process.env.NEXT_PUBLIC_DD_CLIENT_TOKEN || "";

if (typeof window !== "undefined" && applicationId && clientToken) {
  datadogRum.init({
    applicationId,
    clientToken,
    site: "datadoghq.com",
    service: "vantara-frontend",
    env: process.env.NODE_ENV,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: "mask-user-input",
  });
}

export function DatadogRum() {
  return null;
}
