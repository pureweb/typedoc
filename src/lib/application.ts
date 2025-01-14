import * as Path from "path";
import * as FS from "fs";
import * as ts from "typescript";

import { Converter, DocumentationEntrypoint } from "./converter/index";
import { Renderer } from "./output/renderer";
import { Serializer } from "./serialization";
import { ProjectReflection } from "./models/index";
import { getCommonDirectory } from "./utils/fs";
import {
    Logger,
    ConsoleLogger,
    CallbackLogger,
    PluginHost,
    normalizePath,
    ensureDirectoriesExist,
} from "./utils/index";
import { createMinimatch } from "./utils/paths";

import {
    AbstractComponent,
    ChildableComponent,
    Component,
    DUMMY_APPLICATION_OWNER,
} from "./utils/component";
import { Options, BindOption } from "./utils";
import { TypeDocOptions } from "./utils/options/declaration";
import { flatMap } from "./utils/array";
import { basename, resolve } from "path";
import {
    expandPackages,
    getTsEntryPointForPackage,
    ignorePackage,
    loadPackageManifest,
} from "./utils/package-manifest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageInfo = require("../../package.json") as {
    version: string;
    peerDependencies: { typescript: string };
};

const supportedVersionMajorMinor = packageInfo.peerDependencies.typescript
    .split("||")
    .map((version) => version.replace(/^\s*|\.x\s*$/g, ""));

/**
 * Expand the provided packages configuration paths, determining the entry points
 * and creating the ts.Programs for any which are found.
 * @param logger
 * @param packageGlobPaths
 * @returns The information about the discovered programs, undefined if an error occurs.
 */
function getEntrypointsForPackages(
    logger: Logger,
    packageGlobPaths: string[]
): DocumentationEntrypoint[] | undefined {
    const results = new Array<DocumentationEntrypoint>();
    // --packages arguments are workspace tree roots, or glob patterns
    // This expands them to leave only leaf packages
    const expandedPackages = expandPackages(logger, ".", packageGlobPaths);
    for (const packagePath of expandedPackages) {
        const packageJsonPath = resolve(packagePath, "package.json");
        const packageJson = loadPackageManifest(logger, packageJsonPath);
        if (packageJson === undefined) {
            logger.error(`Could not load package manifest ${packageJsonPath}`);
            return;
        }
        const packageEntryPoint = getTsEntryPointForPackage(
            logger,
            packageJsonPath,
            packageJson
        );
        if (packageEntryPoint === undefined) {
            logger.error(
                `Could not determine TS entry point for package ${packageJsonPath}`
            );
            return;
        }
        if (packageEntryPoint === ignorePackage) {
            continue;
        }
        const tsconfigFile = ts.findConfigFile(
            packageEntryPoint,
            ts.sys.fileExists
        );
        if (tsconfigFile === undefined) {
            logger.error(
                `Could not determine tsconfig.json for source file ${packageEntryPoint} (it must be on an ancestor path)`
            );
            return;
        }
        // Consider deduplicating this with similar code in src/lib/utils/options/readers/tsconfig.ts
        let fatalError = false;
        const parsedCommandLine = ts.getParsedCommandLineOfConfigFile(
            tsconfigFile,
            {},
            {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic: (error) => {
                    logger.diagnostic(error);
                    fatalError = true;
                },
            }
        );
        if (!parsedCommandLine) {
            return;
        }
        logger.diagnostics(parsedCommandLine.errors);
        if (fatalError) {
            return;
        }
        const program = ts.createProgram({
            rootNames: parsedCommandLine.fileNames,
            options: parsedCommandLine.options,
        });
        const sourceFile = program.getSourceFile(packageEntryPoint);
        if (sourceFile === undefined) {
            logger.error(
                `Entrypoint "${packageEntryPoint}" does not appear to be built by the tsconfig found at "${tsconfigFile}"`
            );
            return;
        }
        results.push({
            displayName: packageJson.name as string,
            path: packageEntryPoint,
            program,
            sourceFile,
        });
    }
    return results;
}

function getModuleName(fileName: string, baseDir: string) {
    return normalizePath(Path.relative(baseDir, fileName)).replace(
        /(\/index)?(\.d)?\.[tj]sx?$/,
        ""
    );
}

/**
 * The default TypeDoc main application class.
 *
 * This class holds the two main components of TypeDoc, the [[Converter]] and
 * the [[Renderer]]. When running TypeDoc, first the [[Converter]] is invoked which
 * generates a [[ProjectReflection]] from the passed in source files. The
 * [[ProjectReflection]] is a hierarchical model representation of the TypeScript
 * project. Afterwards the model is passed to the [[Renderer]] which uses an instance
 * of [[BaseTheme]] to generate the final documentation.
 *
 * Both the [[Converter]] and the [[Renderer]] are subclasses of the [[AbstractComponent]]
 * and emit a series of events while processing the project. Subscribe to these Events
 * to control the application flow or alter the output.
 */
@Component({ name: "application", internal: true })
export class Application extends ChildableComponent<
    Application,
    AbstractComponent<Application>
> {
    /**
     * The converter used to create the declaration reflections.
     */
    converter: Converter;

    /**
     * The renderer used to generate the documentation output.
     */
    renderer: Renderer;

    /**
     * The serializer used to generate JSON output.
     */
    serializer: Serializer;

    /**
     * The logger that should be used to output messages.
     */
    logger: Logger;

    options: Options;

    plugins: PluginHost;

    @BindOption("logger")
    loggerType!: string | Function;

    @BindOption("exclude")
    exclude!: Array<string>;

    @BindOption("entryPoints")
    entryPoints!: string[];

    @BindOption("options")
    optionsFile!: string;

    @BindOption("tsconfig")
    project!: string;

    /**
     * The version number of TypeDoc.
     */
    static VERSION = packageInfo.version;

    /**
     * Create a new TypeDoc application instance.
     *
     * @param options An object containing the options that should be used.
     */
    constructor() {
        super(DUMMY_APPLICATION_OWNER);

        this.logger = new ConsoleLogger();
        this.options = new Options(this.logger);
        this.options.addDefaultDeclarations();
        this.serializer = new Serializer();
        this.converter = this.addComponent<Converter>("converter", Converter);
        this.renderer = this.addComponent<Renderer>("renderer", Renderer);
        this.plugins = this.addComponent("plugins", PluginHost);
    }

    /**
     * Initialize TypeDoc with the given options object.
     *
     * @param options  The desired options to set.
     */
    bootstrap(options: Partial<TypeDocOptions> = {}): void {
        for (const [key, val] of Object.entries(options)) {
            try {
                this.options.setValue(key as keyof TypeDocOptions, val);
            } catch {
                // Ignore errors, plugins haven't been loaded yet and may declare an option.
            }
        }
        this.options.read(new Logger());

        const logger = this.loggerType;
        if (typeof logger === "function") {
            this.logger = new CallbackLogger(<any>logger);
            this.options.setLogger(this.logger);
        } else if (logger === "none") {
            this.logger = new Logger();
            this.options.setLogger(this.logger);
        }
        this.logger.level = this.options.getValue("logLevel");

        this.plugins.load();

        this.options.reset();
        for (const [key, val] of Object.entries(options)) {
            try {
                this.options.setValue(key as keyof TypeDocOptions, val);
            } catch (error) {
                this.logger.error(error.message);
            }
        }
        this.options.read(this.logger);
    }

    /**
     * Return the application / root component instance.
     */
    get application(): Application {
        return this;
    }

    /**
     * Return the path to the TypeScript compiler.
     */
    public getTypeScriptPath(): string {
        return Path.dirname(require.resolve("typescript"));
    }

    public getTypeScriptVersion(): string {
        return ts.version;
    }

    /**
     * Run the converter for the given set of files and return the generated reflections.
     *
     * @returns An instance of ProjectReflection on success, undefined otherwise.
     */
    public convert(): ProjectReflection | undefined {
        this.logger.verbose(
            "Using TypeScript %s from %s",
            this.getTypeScriptVersion(),
            this.getTypeScriptPath()
        );

        if (
            !supportedVersionMajorMinor.some(
                (version) => version == ts.versionMajorMinor
            )
        ) {
            this.logger.warn(
                `You are running with an unsupported TypeScript version! TypeDoc supports ${supportedVersionMajorMinor.join(
                    ", "
                )}`
            );
        }

        if (
            Object.keys(this.options.getCompilerOptions()).length === 0 &&
            this.application.options.getValue("packages").length === 0
        ) {
            this.logger.warn(
                `No compiler options set. This likely means that TypeDoc did not find your tsconfig.json. Generated documentation will probably be empty.`
            );
        }

        const packages = this.application.options
            .getValue("packages")
            .map(normalizePath);
        const entrypoints = getEntrypointsForPackages(this.logger, packages);
        if (entrypoints === undefined) {
            return;
        }
        if (entrypoints.length === 0) {
            // No package entrypoints were specified. Try to process the file-oriented entry points.
            // The reason this is skipped when using --packages is that this approach currently assumes a global
            // tsconfig compilation setup which is not likely to exist when using --packages.
            entrypoints.push(...this.getEntrypointsForPaths(this.entryPoints));
        }

        const programs = entrypoints.map((e) => e.program);
        this.logger.verbose(`Converting with ${programs.length} programs`);

        const errors = flatMap(programs, ts.getPreEmitDiagnostics);
        if (errors.length) {
            this.logger.diagnostics(errors);
            return;
        }

        if (this.application.options.getValue("emit")) {
            for (const program of programs) {
                program.emit();
            }
        }

        return this.converter.convert(entrypoints);
    }

    public convertAndWatch(
        success: (project: ProjectReflection) => Promise<void>
    ): void {
        if (
            !this.options.getValue("preserveWatchOutput") &&
            this.logger instanceof ConsoleLogger
        ) {
            ts.sys.clearScreen?.();
        }

        this.logger.verbose(
            "Using TypeScript %s from %s",
            this.getTypeScriptVersion(),
            this.getTypeScriptPath()
        );

        if (
            !supportedVersionMajorMinor.some(
                (version) => version == ts.versionMajorMinor
            )
        ) {
            this.logger.warn(
                `You are running with an unsupported TypeScript version! TypeDoc supports ${supportedVersionMajorMinor.join(
                    ", "
                )}`
            );
        }

        if (Object.keys(this.options.getCompilerOptions()).length === 0) {
            this.logger.warn(
                `No compiler options set. This likely means that TypeDoc did not find your tsconfig.json. Generated documentation will probably be empty.`
            );
        }

        // Doing this is considerably more complicated, we'd need to manage an array of programs, not convert until all programs
        // have reported in the first time... just error out for now. I'm not convinced anyone will actually notice.
        if (this.application.options.getFileNames().length === 0) {
            this.logger.error(
                "The provided tsconfig file looks like a solution style tsconfig, which is not supported in watch mode."
            );
            return;
        }

        // Support for packages mode is currently unimplemented
        if (this.application.options.getValue("packages").length !== 0) {
            this.logger.error(
                'Running with "--packages" is not supported in watch mode.'
            );
            return;
        }

        // Matches the behavior of the tsconfig option reader.
        let tsconfigFile = this.options.getValue("tsconfig");
        tsconfigFile =
            ts.findConfigFile(
                tsconfigFile,
                ts.sys.fileExists,
                tsconfigFile.toLowerCase().endsWith(".json")
                    ? basename(tsconfigFile)
                    : undefined
            ) ?? "tsconfig.json";

        // We don't want to do it the first time to preserve initial debug status messages. They'll be lost
        // after the user saves a file, but better than nothing...
        let firstStatusReport = true;

        const host = ts.createWatchCompilerHost(
            tsconfigFile,
            { noEmit: !this.application.options.getValue("emit") },
            ts.sys,
            ts.createEmitAndSemanticDiagnosticsBuilderProgram,
            (diagnostic) => this.logger.diagnostic(diagnostic),
            (status, newLine, _options, errorCount) => {
                if (
                    !firstStatusReport &&
                    errorCount === void 0 &&
                    !this.options.getValue("preserveWatchOutput") &&
                    this.logger instanceof ConsoleLogger
                ) {
                    ts.sys.clearScreen?.();
                }
                firstStatusReport = false;
                this.logger.write(
                    ts.flattenDiagnosticMessageText(status.messageText, newLine)
                );
            }
        );

        let successFinished = true;
        let currentProgram: ts.Program | undefined;

        const runSuccess = () => {
            if (!currentProgram) {
                return;
            }

            if (successFinished) {
                this.logger.resetErrors();
                const inputFiles = this.expandInputFiles(this.entryPoints);
                const baseDir = getCommonDirectory(inputFiles);
                const entrypoints = new Array<DocumentationEntrypoint>();
                for (const file of inputFiles.map(normalizePath)) {
                    const sourceFile = currentProgram.getSourceFile(file);
                    if (sourceFile) {
                        entrypoints.push({
                            displayName: getModuleName(resolve(file), baseDir),
                            path: file,
                            sourceFile,
                            program: currentProgram,
                        });
                    } else {
                        this.application.logger.warn(
                            `Unable to locate entry point: ${file} within the program defined by ${tsconfigFile}`
                        );
                    }
                }
                const project = this.converter.convert(entrypoints);
                currentProgram = undefined;
                successFinished = false;
                success(project).then(() => {
                    successFinished = true;
                    runSuccess();
                });
            }
        };

        const origAfterProgramCreate = host.afterProgramCreate;
        host.afterProgramCreate = (program) => {
            if (ts.getPreEmitDiagnostics(program.getProgram()).length === 0) {
                currentProgram = program.getProgram();
                runSuccess();
            }
            origAfterProgramCreate?.(program);
        };

        ts.createWatchProgram(host);
    }

    /**
     * Render HTML for the given project
     */
    public async generateDocs(
        project: ProjectReflection,
        out: string
    ): Promise<void> {
        out = Path.resolve(out);
        await this.renderer.render(project, out);
        if (this.logger.hasErrors()) {
            this.logger.error(
                "Documentation could not be generated due to the errors above."
            );
        } else {
            this.logger.success("Documentation generated at %s", out);
        }
    }

    /**
     * Run the converter for the given set of files and write the reflections to a json file.
     *
     * @param out The path and file name of the target file.
     * @returns Whether the JSON file could be written successfully.
     */
    public async generateJson(
        project: ProjectReflection,
        out: string
    ): Promise<void> {
        out = Path.resolve(out);
        const eventData = {
            outputDirectory: Path.dirname(out),
            outputFile: Path.basename(out),
        };
        const ser = this.serializer.projectToObject(project, {
            begin: eventData,
            end: eventData,
        });

        const space = this.application.options.getValue("pretty") ? "\t" : "";
        ensureDirectoriesExist(Path.dirname(out));
        await FS.promises.writeFile(out, JSON.stringify(ser, null, space));
        this.logger.success("JSON written to %s", out);
    }

    /**
     * Expand a list of input files.
     *
     * Searches for directories in the input files list and replaces them with a
     * listing of all TypeScript files within them. One may use the ```--exclude``` option
     * to filter out files with a pattern.
     *
     * @param inputFiles  The list of files that should be expanded.
     * @returns  The list of input files with expanded directories.
     */
    public expandInputFiles(inputFiles: readonly string[]): string[] {
        const files: string[] = [];

        const exclude = createMinimatch(this.exclude);

        function isExcluded(fileName: string): boolean {
            return exclude.some((mm) => mm.match(fileName));
        }

        const supportedFileRegex =
            this.options.getCompilerOptions().allowJs ||
            this.options.getCompilerOptions().checkJs
                ? /\.[tj]sx?$/
                : /\.tsx?$/;
        function add(file: string, entryPoint: boolean) {
            let stats: FS.Stats;
            try {
                stats = FS.statSync(file);
            } catch {
                // No permission or a symbolic link, do not resolve.
                return;
            }
            const fileIsDir = stats.isDirectory();
            if (fileIsDir && !file.endsWith("/")) {
                file = `${file}/`;
            }

            if (!entryPoint && isExcluded(normalizePath(file))) {
                return;
            }

            if (fileIsDir) {
                FS.readdirSync(file).forEach((next) => {
                    add(Path.join(file, next), false);
                });
            } else if (supportedFileRegex.test(file)) {
                files.push(normalizePath(file));
            }
        }

        inputFiles.forEach((file) => {
            const resolved = Path.resolve(file);
            if (!FS.existsSync(resolved)) {
                this.logger.warn(
                    `Provided entry point ${file} does not exist and will not be included in the docs.`
                );
                return;
            }

            add(resolved, true);
        });

        return files;
    }

    /**
     * Converts a list of file-oriented paths in to DocumentationEntrypoints for conversion.
     * This is in contrast with the package-oriented `getEntrypointsForPackages`
     *
     * @param entryPointPaths  The list of filepaths that should be expanded.
     * @returns  The DocumentationEntrypoints corresponding to all the found entrypoints
     */
    public getEntrypointsForPaths(
        entryPointPaths: string[]
    ): DocumentationEntrypoint[] {
        const rootProgram = ts.createProgram({
            rootNames: this.application.options.getFileNames(),
            options: this.application.options.getCompilerOptions(),
            projectReferences: this.application.options.getProjectReferences(),
        });
        const programs = new Array<ts.Program>();
        programs.push(rootProgram);
        // This might be a solution style tsconfig, in which case we need to add a program for each
        // reference so that the converter can look through each of these.
        if (rootProgram.getRootFileNames().length === 0) {
            this.logger.verbose(
                "tsconfig appears to be a solution style tsconfig - creating programs for references"
            );
            const resolvedReferences = rootProgram.getResolvedProjectReferences();
            for (const ref of resolvedReferences ?? []) {
                if (!ref) continue; // This indicates bad configuration... will be reported later.

                programs.push(
                    ts.createProgram({
                        options: ref.commandLine.options,
                        rootNames: ref.commandLine.fileNames,
                        projectReferences: ref.commandLine.projectReferences,
                    })
                );
            }
        }
        const inputFiles = this.expandInputFiles(entryPointPaths);
        const baseDir = getCommonDirectory(inputFiles);
        const entrypoints = new Array<DocumentationEntrypoint>();
        entryLoop: for (const file of inputFiles.map(normalizePath)) {
            for (const program of programs) {
                const sourceFile = program.getSourceFile(file);
                if (sourceFile) {
                    entrypoints.push({
                        displayName: getModuleName(resolve(file), baseDir),
                        path: file,
                        sourceFile,
                        program,
                    });
                    continue entryLoop;
                }
            }
            this.application.logger.warn(
                `Unable to locate entry point: ${file}`
            );
        }
        return entrypoints;
    }

    /**
     * Print the version number.
     */
    toString() {
        return [
            "",
            `TypeDoc ${Application.VERSION}`,
            `Using TypeScript ${this.getTypeScriptVersion()} from ${this.getTypeScriptPath()}`,
            "",
        ].join("\n");
    }
}
