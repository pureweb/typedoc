"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypeScript = exports.JSONOutput = exports.ArgumentsReader = exports.TypeDocReader = exports.TSConfigReader = exports.ParameterType = exports.ParameterHint = exports.Options = exports.BindOption = exports.UrlMapping = exports.NavigationItem = exports.NavigationBuilder = exports.DefaultTheme = exports.Renderer = exports.Converter = exports.normalizePath = exports.resetReflectionID = exports.Event = exports.EventDispatcher = exports.Application = void 0;
var application_1 = require("./lib/application");
Object.defineProperty(exports, "Application", { enumerable: true, get: function () { return application_1.Application; } });
var events_1 = require("./lib/utils/events");
Object.defineProperty(exports, "EventDispatcher", { enumerable: true, get: function () { return events_1.EventDispatcher; } });
Object.defineProperty(exports, "Event", { enumerable: true, get: function () { return events_1.Event; } });
var abstract_1 = require("./lib/models/reflections/abstract");
Object.defineProperty(exports, "resetReflectionID", { enumerable: true, get: function () { return abstract_1.resetReflectionID; } });
var fs_1 = require("./lib/utils/fs");
Object.defineProperty(exports, "normalizePath", { enumerable: true, get: function () { return fs_1.normalizePath; } });
__exportStar(require("./lib/models/reflections"), exports);
var converter_1 = require("./lib/converter");
Object.defineProperty(exports, "Converter", { enumerable: true, get: function () { return converter_1.Converter; } });
var renderer_1 = require("./lib/output/renderer");
Object.defineProperty(exports, "Renderer", { enumerable: true, get: function () { return renderer_1.Renderer; } });
var DefaultTheme_1 = require("./lib/output/themes/DefaultTheme");
Object.defineProperty(exports, "DefaultTheme", { enumerable: true, get: function () { return DefaultTheme_1.DefaultTheme; } });
Object.defineProperty(exports, "NavigationBuilder", { enumerable: true, get: function () { return DefaultTheme_1.NavigationBuilder; } });
var NavigationItem_1 = require("./lib/output/models/NavigationItem");
Object.defineProperty(exports, "NavigationItem", { enumerable: true, get: function () { return NavigationItem_1.NavigationItem; } });
var UrlMapping_1 = require("./lib/output/models/UrlMapping");
Object.defineProperty(exports, "UrlMapping", { enumerable: true, get: function () { return UrlMapping_1.UrlMapping; } });
var options_1 = require("./lib/utils/options");
Object.defineProperty(exports, "BindOption", { enumerable: true, get: function () { return options_1.BindOption; } });
Object.defineProperty(exports, "Options", { enumerable: true, get: function () { return options_1.Options; } });
Object.defineProperty(exports, "ParameterHint", { enumerable: true, get: function () { return options_1.ParameterHint; } });
Object.defineProperty(exports, "ParameterType", { enumerable: true, get: function () { return options_1.ParameterType; } });
Object.defineProperty(exports, "TSConfigReader", { enumerable: true, get: function () { return options_1.TSConfigReader; } });
Object.defineProperty(exports, "TypeDocReader", { enumerable: true, get: function () { return options_1.TypeDocReader; } });
Object.defineProperty(exports, "ArgumentsReader", { enumerable: true, get: function () { return options_1.ArgumentsReader; } });
var serialization_1 = require("./lib/serialization");
Object.defineProperty(exports, "JSONOutput", { enumerable: true, get: function () { return serialization_1.JSONOutput; } });
const TypeScript = require("typescript");
exports.TypeScript = TypeScript;
//# sourceMappingURL=index.js.map