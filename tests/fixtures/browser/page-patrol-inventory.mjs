import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import process from 'node:process';
import console from 'node:console';

// Evidence inventory, not a passing test: runtime flows must be verified separately.
export async function pagePatrolInventory() {
  const routes = new Set();
  const pages = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.tsx?$/u.test(file)) {
        const source = await readFile(file, 'utf8');
        const ast = ts.createSourceFile(
          file,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        const nativeControls = [];
        const interactions = [];
        const colors = [];
        const nativeDateInputs = [];
        const imports = [];
        const walk = (node) => {
          const line =
            ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          if (ts.isImportDeclaration(node))
            imports.push(node.moduleSpecifier.text);
          if (ts.isObjectLiteralExpression(node)) {
            const props = new Map(
              node.properties
                .filter(ts.isPropertyAssignment)
                .map((p) => [p.name.getText(ast), p.initializer]),
            );
            const route = props.get('path');
            if (
              route &&
              ts.isStringLiteral(route) &&
              route.text.startsWith('/') &&
              !/[:*]/u.test(route.text) &&
              props.has('componentLoader')
            )
              routes.add(route.text);
          }
          if (
            ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)
          ) {
            const tag = node.tagName.getText(ast);
            const attributes = node.attributes.getText(ast);
            if (
              (tag === 'Input' || tag === 'input') &&
              /\btype\s*=\s*(?:['"]date['"]|\{[^}]*['"]date['"][^}]*\})/su.test(
                attributes,
              )
            )
              nativeDateInputs.push({ line, tag });
            if (/^(button|input|select|textarea|dialog)$/u.test(tag))
              nativeControls.push({ line, tag, attributes });
            if (
              /^(Button|.*Trigger|.*Item|Tabs.*|Link|NavLink)$/u.test(tag) ||
              /\bonClick=/u.test(attributes)
            )
              interactions.push({ line, tag });
            if (
              /#[\da-f]{3,8}\b|\b(?:bg|text|border)-(?:red|green|blue|yellow|orange|emerald|amber|violet|purple|slate|gray|zinc)-\d/iu.test(
                attributes,
              )
            )
              colors.push({ line, tag, attributes });
          }
          ts.forEachChild(node, walk);
        };
        walk(ast);
        if (file.startsWith('client/pages/'))
          pages.push({
            file,
            imports,
            nativeControls,
            interactions,
            colors,
            nativeDateInputs,
          });
      }
    }
  }
  await visit('client/pages');
  await visit('client/route-modules');
  // The composition root contributes home, inbox, and public auth pages.
  const root = ts.createSourceFile(
    'client/routes.ts',
    await readFile('client/routes.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const walkRoot = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => [p.name.getText(root), p.initializer]),
      );
      const route = props.get('path');
      if (
        route &&
        ts.isStringLiteral(route) &&
        route.text.startsWith('/') &&
        !/[:*]/u.test(route.text) &&
        props.has('componentLoader')
      )
        routes.add(route.text);
    }
    ts.forEachChild(node, walkRoot);
  };
  walkRoot(root);
  return {
    routes: [...routes].sort(),
    pages,
    summary: {
      files: pages.length,
      interactions: pages.reduce((n, p) => n + p.interactions.length, 0),
      nativeControls: pages.reduce((n, p) => n + p.nativeControls.length, 0),
      literalColors: pages.reduce((n, p) => n + p.colors.length, 0),
      nativeDateInputs: pages.reduce(
        (n, p) => n + p.nativeDateInputs.length,
        0,
      ),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await pagePatrolInventory();
  const directory = 'storage/ui-workflow/role-page-patrol-2026-10-13';
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'source-inventory.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ routes: result.routes.length, ...result.summary }),
  );
}
