import { dirname, join } from 'path';
import type { CompilerOptions } from 'typescript';
import { logger, NX_PREFIX, stripIndent } from './logger';

const swcNodeInstalled = packageIsInstalled('@swc-node/register');
const tsNodeInstalled = packageIsInstalled('ts-node/register');
let ts: typeof import('typescript');

/**
 * Optionally, if swc-node and tsconfig-paths are available in the current workspace, apply the require
 * register hooks so that .ts files can be used for writing custom workspace projects.
 *
 * If ts-node and tsconfig-paths are not available, the user can still provide an index.js file in
 * the root of their project and the fundamentals will still work (but
 * workspace path mapping will not, for example).
 *
 * @returns cleanup function
 */
export const registerTsProject = (
  path: string,
  configFilename = 'tsconfig.json'
): (() => void) => {
  const tsConfigPath = join(path, configFilename);

  const compilerOptions: CompilerOptions = readCompilerOptions(tsConfigPath);
  const cleanupFunctions = [
    registerTsConfigPaths(tsConfigPath),
    registerTranspiler(compilerOptions),
  ];

  return () => {
    for (const fn of cleanupFunctions) {
      fn();
    }
  };
};

/**
 * Register ts-node or swc-node given a set of compiler options.
 *
 * Note: Several options require enums from typescript. To avoid importing typescript,
 * use import type + raw values
 *
 * @returns cleanup method
 */
export function registerTranspiler(
  compilerOptions: CompilerOptions
): () => void {
  // Function to register transpiler that returns cleanup function
  let registerTranspiler: () => () => void;

  if (swcNodeInstalled) {
    // These are requires to prevent it from registering when it shouldn't
    const { register } =
      require('@swc-node/register/register') as typeof import('@swc-node/register/register');

    registerTranspiler = () => register(compilerOptions);
  } else {
    // We can fall back on ts-node if its available

    if (tsNodeInstalled) {
      const { register } = require('ts-node') as typeof import('ts-node');
      // ts-node doesn't provide a cleanup method
      registerTranspiler = () => {
        const service = register({
          transpileOnly: true,
          compilerOptions: getTsNodeCompilerOptions(compilerOptions),
        });
        // Don't warn if a faster transpiler is enabled
        if (!service.options.transpiler && !service.options.swc) {
          warnTsNodeUsage();
        }
        return () => {};
      };
    }
  }

  if (registerTranspiler) {
    return registerTranspiler();
  } else {
    warnNoTranspiler();
    return () => {};
  }
}

/**
 * @param tsConfigPath Adds the paths from a tsconfig file into node resolutions
 * @returns cleanup function
 */
export function registerTsConfigPaths(tsConfigPath): () => void {
  try {
    /**
     * Load the ts config from the source project
     */
    const tsconfigPaths: typeof import('tsconfig-paths') = require('tsconfig-paths');
    const tsConfigResult = tsconfigPaths.loadConfig(tsConfigPath);
    /**
     * Register the custom workspace path mappings with node so that workspace libraries
     * can be imported and used within project
     */
    if (tsConfigResult.resultType === 'success') {
      return tsconfigPaths.register({
        baseUrl: tsConfigResult.absoluteBaseUrl,
        paths: tsConfigResult.paths,
      });
    }
  } catch (err) {
    warnNoTsconfigPaths();
  }
  return () => {};
}

function readCompilerOptions(tsConfigPath): CompilerOptions {
  if (swcNodeInstalled) {
    const {
      readDefaultTsConfig,
    }: typeof import('@swc-node/register/read-default-tsconfig') = require('@swc-node/register/read-default-tsconfig');
    return readDefaultTsConfig(tsConfigPath);
  } else {
    return readCompilerOptionsWithTypescript(tsConfigPath);
  }
}

function readCompilerOptionsWithTypescript(tsConfigPath) {
  if (!ts) {
    ts = require('typescript');
  }
  const { readConfigFile, parseJsonConfigFileContent, sys } = ts;
  const jsonContent = readConfigFile(tsConfigPath, sys.readFile);
  const { options } = parseJsonConfigFileContent(
    jsonContent,
    sys,
    dirname(tsConfigPath)
  );
  // This property is returned in compiler options for some reason, but not part of the typings.
  // ts-node fails on unknown props, so we have to remove it.
  delete options.configFilePath;
  return options;
}

function warnTsNodeUsage() {
  logger.warn(
    stripIndent(`${NX_PREFIX} Falling back to ts-node for local typescript execution. This may be a little slower.
  - To fix this, ensure @swc-node/register and @swc/core have been installed`)
  );
}

function warnNoTsconfigPaths() {
  logger.warn(
    stripIndent(`${NX_PREFIX} Unable to load tsconfig-paths, workspace libraries may be inaccessible.
  - To fix this, install tsconfig-paths with npm/yarn/pnpm`)
  );
}

function warnNoTranspiler() {
  logger.warn(
    stripIndent(`${NX_PREFIX} Unable to locate swc-node or ts-node. Nx will be unable to run local ts files without transpiling.
  - To fix this, ensure @swc-node/register and @swc/core have been installed`)
  );
}

function packageIsInstalled(m: string) {
  try {
    const p = require.resolve(m);
    return true;
  } catch {
    return false;
  }
}

/**
 * ts-node requires string values for enum based typescript options.
 * `register`'s signature just types the field as `object`, so we
 * unfortunately do not get any kind of type safety on this.
 */
export function getTsNodeCompilerOptions(compilerOptions: CompilerOptions) {
  if (!ts) {
    ts = require('typescript');
  }

  const flagMap: Partial<
    Record<keyof RemoveIndex<CompilerOptions>, keyof typeof ts>
  > = {
    module: 'ModuleKind',
    target: 'ScriptTarget',
    moduleDetection: 'ModuleDetectionKind',
    newLine: 'NewLineKind',
    moduleResolution: 'ModuleResolutionKind',
    importsNotUsedAsValues: 'ImportsNotUsedAsValues',
  };

  const result = { ...compilerOptions };

  for (const flag in flagMap) {
    if (compilerOptions[flag]) {
      result[flag] = ts[flagMap[flag]][compilerOptions[flag]];
    }
  }

  return result;
}

/**
 * Index keys allow empty objects, where as "real" keys
 * require a value. Thus, this filters out index keys
 * See: https://stackoverflow.com/a/68261113/3662471
 */
type RemoveIndex<T> = {
  [K in keyof T as {} extends Record<K, 1> ? never : K]: T[K];
};
