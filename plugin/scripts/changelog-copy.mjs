// Reviewed historical wording; keys are full commit IDs. False omits an internal-only
// change, not its version. This build-time map is not shipped with the plugin.
export const overrides = {
  f8b9a14d250557cdca3b514c7dbb2c6072eff171: {
    category: 'fixes',
    text: 'GitHub settings explain that notifications need a separate classic token.',
  },
  '1a9adf579caa4b0ce05d4864bb5b2aaa27617aa8': {
    category: 'fixes',
    text: 'GitHub notification rows no longer have an unnecessary indent.',
  },
  '9ec77939e87575ab5d3617326d230a3b89b1a500': false,
  b44fe6314d15f1f7f1c3ca9534dace2d2cdc9560: {
    category: 'fixes',
    text: 'Bulk tool controls keep Off, Ask and Auto side by side on a phone.',
  },
  '16e394846ba6fd9d53e1cda994fc8af9de0d6af2': false,
  ab3851ca24a9ac5622d4e11f71ee58eb4a512f4a: {
    category: 'fixes',
    text: 'Switching property drawing redraws only the properties on screen.',
  },
  '9b34308ca5721c21e6b5818ab5003d50e0d004f5': {
    category: 'fixes',
    text: 'The pen draws a little wider and its selected black swatch stays black.',
  },
  '71883278d10ddaf9d4413afa1cf9ea6677d6f043': {
    category: 'fixes',
    text: 'Book pages are laid out again when their fonts arrive, keeping paragraphs from overlapping.',
  },
  '69f04996a87c8750e550c91ee13f927ff3f2ea39': {
    category: 'fixes',
    text: 'A book with an unavailable saved place opens at its start instead of failing to open.',
  },
  a05627315cec3a307558d7ef898e3f924473d3ed: {
    category: 'fixes',
    text: 'Failed background chat-history and settings writes are reported without disrupting the app.',
  },
  '5c916eb561ac7e74ef9c333945ffeee368c996f7': false,
  '8dc1e731f327305a14ab0c3f1103d0b68474d74e': false,
  '4128b407bdccfcb474aab3fd733b6efc19de10ab': {
    category: 'fixes',
    text: 'Label filter menus show the selected labels correctly on macOS.',
  },
  '55cf464012fe5bcde2f95cbe211582b02f3bc901': {
    category: 'fixes',
    text: 'Root actions in script HTML views work as documented.',
  },
  '51a40a9cca1fa39c473f1cf0756139f515786f77': {
    category: 'fixes',
    text: 'Inspecting a script view produces a bounded result, even for cyclic structures.',
  },
  '489c6ac4e3699bca29c0816cb385f2d5c48544ab': {
    category: 'features',
    text: 'Script views use the plugin’s native-style controls.',
  },
  '643f783301d14cfb7188d17a08bb3cdc6bc2b8e3': {
    category: 'fixes',
    text: 'Script views can update their actions and safely search nested controls.',
  },
  '91a79519d6b4a293b51af3b4c1076e5979108383': false,
  ca6e6d16744fd5ac5cd73853136365b5844e8e53: {
    category: 'features',
    text: 'Scripts can choose how long to wait for a network response.',
  },
  '97943d930c92e5432021375e3aa68bcc8cf58878': false,
  '0504d521fe774b35d70e4705f46d500d1cc5ba7f': false,
  '41f307d416908bdee4c8115f00a7b707a3a68dae': false,
  '1083d4bc25ed82eebb7664ca3a7bd59f24ea416a': false,
  '532a2d44dea15108e2606371c8e3ae29fce990c8': {
    category: 'features',
    text: 'A dedicated Comment agent is available for note discussions.',
  },
  fee582416a6fa118a6773f82d13a6ee4cc78d8d4: {
    category: 'features',
    text: 'A comment can have its own conversation attached to a note.',
  },
  b89140052ddc4ccee11c1499c86e3b4adcf7339e: {
    category: 'features',
    text: 'Comments open beside their passage in the note margin.',
  },
  e2a47e1e59968c0375eb57be04a0aacbbff965f6: false,
  aebc66a3e07179eb655c9039c145dda833ab6092: false,
  bb0c232c9ac46cdbc2cfab23b3cb8c2f6256d4e4: {
    category: 'features',
    text: 'Comments can be attached to a passage in a note.',
  },
  '62d5e4190d925abe8ac6c6c3597e8f84e6ef1869': false,
  a3a567e5e34028a3f8b9b94c3b25ce2aeff743b8: false,
  cb421059318f595e008c24b12a52d5bf97f2c268: {
    category: 'fixes',
    text: 'Compatibility fixes for mobile devices and older JavaScript engines.',
  },
  '987e15f167c57ddfe2322ac949778778f9a3721a': false,
  '7781078c0d6259faf4ff4ce0f6015c3c50bf33fc': false,
  '530b64ac2d35e2fba463cf002a82fe9cc06f50c6': {
    category: 'fixes',
    text: 'Popups open in the window containing the control that opened them.',
  },
  cae62ef001ed7289751f1098a34abc7053829e34: {
    category: 'fixes',
    text: 'Local storage and network requests use Obsidian’s device-compatible APIs.',
  },
  '7b170f577bb7f11d8be9d0bb66b0e5393d98c4aa': false,
  '2834536dc4a7e74e96d345f53db00d0485e096cf': {
    category: 'fixes',
    text: 'More controls follow the current Obsidian theme.',
  },
  afb358a0d3f82f17cea7aad4f20269c4e303adab: false,
  '3a8d3ddf528f4e5b0061c1c7edcc0e5696efa8f3': {
    category: 'features',
    text: 'Settings and chat screens share consistent, theme-compatible controls.',
  },
  e1c9b0c68850dbc4341d43ece81a1137acd671ee: {
    category: 'features',
    text: 'Chats follow changes to their agent’s settings.',
  },
  '1cf5b3eb8231bc5b13df6b5e133db938035c33fa': {
    category: 'features',
    text: 'Agents use their configured model and fallback model.',
  },
  c59f2d63e7590cf0d6ae1f9d19249c55e0273c63: false,
  '735abcf40182e7769edcab3e8abc735498543563': {
    category: 'features',
    text: 'Existing AI settings and interceptors are kept when moving to separate agents.',
  },
  '9f9165d7406da81942b7fe04b7e965be254300c3': false,
  efbd7dab459ef213efce5ae1e0e465bcd321b800: {
    category: 'improvements',
    text: 'Long lists under notes load more entries as you scroll, reducing memory use.',
  },
  '8a7a9ef13eb84a3ddcafec657a3cf791e8e83f68': {
    category: 'improvements',
    text: 'Backlinks to group notes are found much faster.',
  },
  '97622a4f334d79bb7baf5703d4cf9be3e953acfe': {
    category: 'improvements',
    text: 'Group-based agent scope is resolved much faster in large vaults.',
  },
  '35cebed8f31ab52e03ab169419ce8a6d67d50476': {
    category: 'improvements',
    text: 'Saving notes causes less of a pause while backlinks update.',
  },
  '30ebfcae2f9b094f800d366041b4e5bdf1582a4d': {
    category: 'fixes',
    text: 'Find and replace opens reliably without an initialization error.',
  },
  '689bf5cc498b7677bb6d3c4e985875b262a9d98d': {
    category: 'fixes',
    text: 'Image-provider settings keep the correct fields and save their keys reliably.',
  },
  '90306a4d0a3c31f001deab80bcd035934b1bd442': {
    category: 'features',
    text: 'Scripts can read the active note path and be stopped, without a fixed run-time limit.',
  },
  '7b88378ba1aa9a0010ee077463aa80a674d98e9c': {
    category: 'features',
    text: 'Pictures can be resized in batches from a gallery and used in an agent chat.',
  },
  '505563485798c248eec5470b870070e4710ab9ce': false,
  b51dda70594487eb5a8c09d198e948f760299659: {
    category: 'fixes',
    text: 'Template variables are parsed consistently when a template is applied repeatedly.',
  },
  '52b4adde29f4e535ad2dece7e336e99d227900b2': false,
  '13307ae25ea0406cb70dd13fb6dae7316678b514': false,
  '005f3e7b39f36fb0477951a32f1f1d3760bf50d9': false,
  b379809e749375ac84c3526bb67e9e8396afd787: {
    category: 'fixes',
    text: 'Linked note names with aliases display without extra brackets.',
  },
  '0e38b0f7f77f674763284efcfe69eb6fc381dc88': {
    category: 'fixes',
    text: 'Note footers release their resources when replaced or closed.',
  },
  '23357f693e2a8226f6e7f26d7837bbf558d09bcb': {
    category: 'fixes',
    text: 'Cross-currency transactions count the correct amount in the sending account.',
  },
  '7fc8d79972370d9d23ca6c98f372b9c26a964204': {
    category: 'fixes',
    text: 'Code blocks have correctly positioned copy buttons and render reliably.',
  },
  '7d23fa2fbcffe77180ec200c1c52e7b495d6e166': false,
  '26c2c0f6b0430fdf4d47851bce91239b988585a8': {
    category: 'fixes',
    text: 'File references support spaces, and search patterns support single-character wildcards.',
  },
  '2cc1dc4289275d34e74eb25cf2875ab70ca89684': false,
  '50e572a628505411a5ebda4ffea3aa9fadb011ae': {
    category: 'features',
    text: 'New tasks record their creation date automatically.',
  },
  '70973a6b0edeadae084a272ce6da3f346ede2fc5': {
    category: 'features',
    text: 'Settings are grouped into tabs.',
  },
  bb7fef28a46e3562c6d0f2347ad016f350dfabe9: false,
}
