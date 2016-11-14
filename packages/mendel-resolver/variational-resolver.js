const ModuleResolver = require('./index');
const path = require('path');
const variationMatches = require('mendel-development/variation-matches');

class VariationalModuleResolver extends ModuleResolver {
    constructor({
        envNames,
        variations,
        // entry related
        variation,
        normalizedId,
        basedir,
        // config params
        projectRoot,
        baseConfig,
        variationConfig,
    }) {
        super({cwd: projectRoot, basedir, envNames});

        this.variationChain = variations.map(variationPath => {
            return path.resolve(projectRoot, variationPath);
        });
        this.baseVarDir = path.resolve(projectRoot, baseConfig.dir);

        this.variation = variation;
        this.normalizedId = normalizedId;
        // config params
        this.projectRoot = projectRoot;
        this.baseConfig = baseConfig;
        this.variationList = variationConfig.variations;
    }

    // Module id is a path without the variational information
    getModuleId(variationalPath) {
        const fileInPlace = path.resolve(this.basedir, variationalPath);
        const match = variationMatches(this.variationList, fileInPlace);

        return match ? match.file : '.';
    }

    isBasePath(modulePath) {
        return path.resolve(modulePath).indexOf(this.baseVarDir) >= 0;
    }

    resolveFile(modulePath) {
        if (this.isBasePath(modulePath) || isNodeModule(modulePath)) {
            return super.resolveFile(modulePath);
        }

        let promise = Promise.reject();
        const moduleId = this.getModuleId(modulePath);

        this.variationChain.forEach(variation => {
            promise = promise.catch(() => super.resolveFile(path.resolve(variation, moduleId)));
        });
        return promise;
    }

    _processPackageJson(moduleName, pkg) {
        // Easy case: package.json was present in the variational directory
        // we won't merge base's and variation's package.json so this package.json
        // MUST contain complete information that resolves perfectly.
        const resolveFiles = this.envNames
            .filter(name => pkg[name])
            .map(name => {
                return this.resolveFile(path.join(moduleName, pkg[name]))
                    // `resolveFile` returns Object with all values the same and that is useless for us.
                    .then(fileResolved => ({name, path: fileResolved[name]}))
                    // Even if file does not resolve, let's not make the promise all fail fast.
                    .catch(() => {});
            });

        return Promise.all(resolveFiles).then(resolves => {
            const resolved = {};
            // for failed case, we returned undefined in the catch above so lets filter that out.
            resolves.filter(Boolean).forEach(({name, path}) => {
                resolved[name] = path;
            });
            this.envNames.filter(name => !resolved[name]).forEach(name => resolved[name] = resolved.main);
            return resolved;
        });
    }

    resolveDir(moduleName) {
        if (this.isBasePath(moduleName) || isNodeModule(moduleName)) return super.resolveDir(moduleName);

        const moduleId = this.getModuleId(moduleName);
        let promise = Promise.reject();
        this.variationChain.forEach(variation => {
            const packagePath = path.join(variation, moduleId, '/package.json');
            promise = promise.catch(() => {
                return this.readPackageJson(packagePath).then(varPackageJson => this._processPackageJson(moduleName, varPackageJson));
            });
        });

        return promise.catch(() => this.resolveFile(path.join(moduleName, 'index')));
    }
}

function isNodeModule(id) {
    return id.indexOf('node_modules') >= 0;
}

module.exports = VariationalModuleResolver;