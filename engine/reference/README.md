# Build 27 reference (frozen, do not edit)

These are the build 27 wireframe's engine (`engine.js`), sample data (`seed.js`) and the node checks it
ran (`checks/t*.js`), copied unchanged. They are the specification for the Python engine in
`engine/aura_engine` and are used only by `tests/equivalence/record.js` to regenerate `golden.json`.

To run the original node checks: `cd checks && cat ../engine.js ../seed.js > eng.js && node t6.js; rm eng.js`.
Their Python versions are in `tests/behavior`.
