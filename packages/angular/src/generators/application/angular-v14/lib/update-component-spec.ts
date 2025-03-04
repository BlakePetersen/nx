import type { Tree } from '@nrwl/devkit';
import type { NormalizedSchema } from './normalized-schema';

import { insertImport } from '@nrwl/workspace/src/utilities/ast-utils';
import {
  addImportToTestBed,
  replaceIntoToTestBed,
} from '../../../../utils/nx-devkit/ast-utils';

let tsModule: typeof import('typescript');

export function updateComponentSpec(host: Tree, options: NormalizedSchema) {
  if (!tsModule) {
    tsModule = require('typescript');
  }
  if (options.skipTests !== true) {
    const componentSpecPath = `${options.appProjectRoot}/src/app/app.component.spec.ts`;
    const componentSpecSource = host.read(componentSpecPath, 'utf-8');

    let componentSpecSourceFile = tsModule.createSourceFile(
      componentSpecPath,
      componentSpecSource,
      tsModule.ScriptTarget.Latest,
      true
    );

    host.write(
      componentSpecPath,
      componentSpecSource
        .replace('.content span', 'h1')
        .replace(`${options.name} app is running!`, `Welcome ${options.name}`)
    );

    // Adding NxWelcome component to app.component.spec
    componentSpecSourceFile = insertImport(
      host,
      componentSpecSourceFile,
      componentSpecPath,
      'NxWelcomeComponent',
      './nx-welcome.component'
    );

    componentSpecSourceFile = replaceIntoToTestBed(
      host,
      componentSpecSourceFile,
      componentSpecPath,
      `declarations: [AppComponent, NxWelcomeComponent]`,
      `
      declarations: [
        AppComponent
      ],
    `
    );

    if (options.routing) {
      componentSpecSourceFile = insertImport(
        host,
        componentSpecSourceFile,
        componentSpecPath,
        'RouterTestingModule',
        '@angular/router/testing'
      );

      componentSpecSourceFile = addImportToTestBed(
        host,
        componentSpecSourceFile,
        componentSpecPath,
        `RouterTestingModule`
      );
    }
  }
}
