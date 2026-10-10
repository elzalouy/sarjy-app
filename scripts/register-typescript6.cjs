const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const projectPackageUrl = pathToFileURL(
  path.join(__dirname, "..", "package.json"),
).href;

function usesTypeScript6Api(parentURL) {
  return (
    typeof parentURL === "string" &&
    (parentURL.includes("/typescript-eslint/") ||
      parentURL.includes("/@typescript-eslint/") ||
      parentURL.includes("/ts-api-utils/"))
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier === "typescript" || specifier.startsWith("typescript/")) &&
      usesTypeScript6Api(context.parentURL)
    ) {
      const redirected =
        specifier === "typescript"
          ? "@typescript/typescript6"
          : `@typescript/typescript6/${specifier.slice("typescript/".length)}`;
      return nextResolve(redirected, {
        ...context,
        parentURL: projectPackageUrl,
      });
    }

    return nextResolve(specifier, context);
  },
});
