import { AisProtocolError } from "./protocol-error.js";

export function parseAisFeatureLoader(
  html: string,
  loaderUrl: URL,
  expectedTarget: URL,
): URL {
  const matches = [
    ...html.matchAll(
      /(?:(?:top|parent)\.)?(mainFrame|viewFrame)\.location\.href\s*=\s*(["'])([^"']+)\2/giu,
    ),
  ];
  let mainTargetCount = 0;
  for (const match of matches) {
    let target: URL;
    try {
      target = new URL(match[3] ?? "", loaderUrl);
    } catch {
      throw new AisProtocolError("feature_loader_changed");
    }
    const frame = match[1];
    if (frame === "mainFrame" && target.href === expectedTarget.href) {
      mainTargetCount += 1;
      continue;
    }
    if (frame === "viewFrame" && target.href === "about:blank") continue;
    throw new AisProtocolError("feature_loader_changed");
  }
  if (mainTargetCount !== 1) {
    throw new AisProtocolError("feature_loader_changed");
  }
  return expectedTarget;
}
