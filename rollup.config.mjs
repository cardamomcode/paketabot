import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const stripTrailingWhitespace = () => ({
  name: "strip-trailing-whitespace",
  renderChunk(code) {
    return { code: code.replace(/[ \t]+$/gm, ""), map: null };
  },
});

const plugins = () => [
  nodeResolve({ preferBuiltins: true }),
  commonjs(),
  stripTrailingWhitespace(),
];

const external = (id) => id.startsWith("node:");

export default [
  {
    input: "build/js/app/Program.js",
    output: {
      file: "dist/index.js",
      format: "es",
    },
    external,
    plugins: plugins(),
  },
  {
    input: "build/js/runner/Program.js",
    output: {
      file: "dist/runner.mjs",
      format: "es",
    },
    external,
    plugins: plugins(),
  },
];
