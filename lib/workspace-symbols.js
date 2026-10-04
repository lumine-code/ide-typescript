const { pathToFileURL } = require("url");

const kinds = {
  class: 5,
  interface: 11,
  enum: 10,
  "enum member": 22,
  module: 2,
  method: 6,
  function: 12,
  property: 7,
  getter: 7,
  setter: 7,
  constructor: 9,
  type: 5,
  const: 14,
};

// The server's standard workspace/symbol request supplies its last open file,
// which restricts navto to that file's projects. Leaving file out searches all
// projects already activated in this session, as VS Code's TS provider does.
module.exports = async (query, { session, signal }) => {
  signal?.throwIfAborted();
  const response = await session.request(
    "workspace/executeCommand",
    {
      command: "typescript.tsserverRequest",
      arguments: ["navto", { searchValue: query, maxResultCount: 256 }],
    },
    { signal },
  );
  signal?.throwIfAborted();
  if (response?.type !== "response" || !Array.isArray(response.body)) return [];
  return response.body.flatMap((item) => {
    if (!item.file || !item.start || !item.end) return [];
    return [
      {
        name: item.name,
        kind: kinds[item.kind] || 13,
        containerName: item.containerName || "",
        location: {
          uri: pathToFileURL(item.file).href,
          range: {
            start: { line: item.start.line - 1, character: item.start.offset - 1 },
            end: { line: item.end.line - 1, character: item.end.offset - 1 },
          },
        },
      },
    ];
  });
};
