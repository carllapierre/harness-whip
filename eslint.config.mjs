import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**", ".cache/**", "coverage/**"] },
    eslint.configs.recommended,
    {
        files: ["**/*.mjs"],
        languageOptions: { globals: { process: "readonly", URL: "readonly", console: "readonly" } },
    },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        rules: { curly: ["error", "all"], "@typescript-eslint/no-explicit-any": "error" },
    },
    {
        files: ["src/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        "node:*",
                        "**/application/**",
                        "**/infrastructure/**",
                        "**/presentation/**",
                        "**/composition/**",
                    ],
                },
            ],
        },
    },
    {
        files: ["src/application/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        "node:*",
                        "**/infrastructure/**",
                        "**/presentation/**",
                        "**/composition/**",
                    ],
                },
            ],
        },
    },
);
