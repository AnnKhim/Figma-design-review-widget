import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  bundle: true,
  entryPoints: ['src/code.tsx'],
  format: 'iife',
  platform: 'browser',
  target: ['es2015'],
  outfile: 'dist/code.js',
  jsxFactory: 'figma.widget.h',
  jsxFragment: 'figma.widget.Fragment',
  logLevel: 'info'
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
