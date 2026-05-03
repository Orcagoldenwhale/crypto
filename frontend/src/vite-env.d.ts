/// <reference types="vite/client" />

/**
 * Глобальные константы, инжектируемые Vite через `define` в vite.config.ts.
 * Они заменяются на литералы во время компиляции.
 */
declare const __BUILD_TIME__: string;
