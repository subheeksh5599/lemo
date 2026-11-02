export const REPO_URL = 'https://github.com/subheeksh5599/lemo'
export const PORTALDOT_DOCS_URL =
  'https://portaldot-dev.readthedocs.io/en/latest/'
export const STATEMENT_STORE_URL =
  'https://docs.polkadot.com/reference/apps/infrastructure/statement-store/'

export const TITLE = {
  id: '0x7f3a9c4e2b81d05a6c47e9f1b3d28a5c6e90f4b2',
  shortId: '0x7f3a…c19e',
  asset: 'POT',
  backing: '100.00',
  owner: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  shortOwner: '5Grw…utQY',
  identity: 'Verified',
  vesting: '24 months',
  permissions: 'Pure Account',
  revision: '07',
  block: '18,442,901',
  proof: '0x9f2c…e41a',
  hash: '0x7f3a9c4e…b2',
}

export const FACES = {
  wasm: [
    { label: 'Backing', value: '100.00 POT' },
    { label: 'Owner', value: TITLE.shortOwner },
    { label: 'Identity', value: TITLE.identity },
    { label: 'Vesting', value: TITLE.vesting },
    { label: 'Permissions', value: TITLE.permissions },
    { label: 'Revision', value: TITLE.revision },
  ],
  erc20: [
    { label: 'Standard', value: 'ERC-20' },
    { label: 'Contract', value: '0xA19c…B3C5' },
    { label: 'Supply', value: '100.00 LEMO' },
    { label: 'Holder', value: '0x8C4e…2f19' },
    { label: 'Backing check', value: 'native proof' },
    { label: 'Revision', value: TITLE.revision },
  ],
  erc721: [
    { label: 'Standard', value: 'ERC-721' },
    { label: 'Contract', value: '0x6d2f…91ab' },
    { label: 'Token', value: '#0042' },
    { label: 'Holder', value: '0x8C4e…2f19' },
    { label: 'Revision', value: TITLE.revision },
  ],
}

export const PROBLEMS = [
  {
    title: 'Ownership stops at the boundary',
    body: 'Native rules do not automatically follow an ERC-20 or ERC-721 representation.',
  },
  {
    title: 'EVM apps cannot see the conditions',
    body: 'Solidity sees a token, not the identity and vesting rules behind it.',
  },
  {
    title: 'Unlocking can strand a representation',
    body: 'Backing can leave while tokens still circulate unless the EVM state is checked.',
  },
  {
    title: 'A sync service becomes the authority',
    body: 'The alternative to proofs is a privileged operator that users must trust.',
  },
]

export const RULES = [
  {
    number: 'Rule 01',
    title: 'EVM cannot move an invalid title',
    body: 'Before any ERC-20 or ERC-721 transfer, the EVM face verifies the current native title against a finalized state proof.',
    checks: [
      'The title exists and its backing is still bound',
      'Identity and vesting conditions remain satisfied',
      'The revision is current and the proof is fresh',
    ],
    allowed: 'Valid, finalized, current proof',
    allowedResult: 'Transfer allowed',
    blocked: 'Identity cleared, backing unbound or proof stale',
    blockedResult: 'Transfer reverts',
  },
  {
    number: 'Rule 02',
    title: 'Backing cannot unlock while tokens circulate',
    body: 'Before native unbonding, the native face verifies the EVM representation against a finalized state proof.',
    checks: [
      'ERC-20 supply is zero, or ERC-721 tokens are retired',
      'The proof belongs to the correct title and contract',
      'The proof is finalized, current and cannot be replayed',
    ],
    allowed: 'Representation fully retired',
    allowedResult: 'Backing unlocks',
    blocked: 'Any representation still outstanding',
    blockedResult: 'Unbond reverts',
  },
]

export const LIFECYCLE = [
  {
    step: '01',
    name: 'Create',
    headline: 'The title is written down',
    body: 'The owner creates a native title and locks the required backing. Ownership, identity conditions and vesting rules are recorded in the native runtime.',
    native: 'Backing locked · identity set · vesting recorded',
    evm: 'No representation issued',
    direction: 'Native record established',
    proof: 'None yet',
    enforced: 'Native title registry',
    revision: '+1',
  },
  {
    step: '02',
    name: 'Represent',
    headline: 'The market face is issued',
    body: 'The EVM representation is created against the same title identifier, but only after the native backing is verified.',
    native: 'Title backed and valid',
    evm: 'ERC-20 supply 100.00 issued',
    direction: 'Native → EVM',
    proof: 'Finalized native title proof',
    enforced: 'EVM proof verifier',
    revision: '+1',
  },
  {
    step: '03',
    name: 'Transfer',
    headline: 'Ownership moves under the title',
    body: 'The representation changes hands through familiar token interfaces. Every transfer re-checks the native title before it settles.',
    native: 'Title unchanged',
    evm: 'Holder changes · supply unchanged',
    direction: 'Native → EVM',
    proof: 'Finalized native proof at current revision',
    enforced: 'EVM transfer validation',
    revision: 'Unchanged',
  },
  {
    step: '04',
    name: 'Update',
    headline: 'A change expires old proofs',
    body: 'If backing, identity or ownership conditions change, the title revision increments. Proofs from the previous revision stop authorizing transfers.',
    native: 'Identity, backing or owner changes',
    evm: 'Waits for an accepted new proof',
    direction: 'Native → EVM',
    proof: 'Proof of the new revision',
    enforced: 'Native registry + freshness checks',
    revision: '+1 · old proofs expire',
  },
  {
    step: '05',
    name: 'Redeem',
    headline: 'Burn first, unlock second',
    body: 'The representation is returned and burned. After the burn is finalized, an EVM state proof releases the original backing.',
    native: 'Backing unlocks last',
    evm: 'Representation burned · supply zero',
    direction: 'EVM → native',
    proof: 'Finalized EVM state proof',
    enforced: 'Native EVM verifier',
    revision: '+1 at burn',
  },
]

export const STATUS_ROWS = [
  { component: 'Dual-face title model', status: 'Design' },
  { component: 'WASM contract runtime on Portaldot V3', status: 'Not launched' },
  { component: 'Native backing and ownership registry', status: 'Implementation required' },
  { component: 'ERC-20 / ERC-721 representation', status: 'Contracts tested, not deployed' },
  { component: 'Native-to-EVM state proof verification', status: 'Tested in TS and Solidity' },
  { component: 'EVM-to-native state proof verification', status: 'Blocked by WASM module' },
  { component: 'Finality and freshness verification', status: 'Service only' },
  { component: 'Revision and replay protection', status: 'Contracts tested, not deployed' },
  { component: 'Root source', status: 'Trusted checkpoint' },
  { component: 'Statement Store', status: 'Transport available' },
  { component: 'End-to-end deployment', status: 'Not demonstrated' },
  { component: 'Security audit', status: 'Not performed' },
]

export const TITLE_RECORD = `LEMO_TITLE {
  title_id           0x7f3a…c19e
  native_asset       POT
  backing_amount     100.00
  native_owner       5Grw…utQY
  identity_status    verified
  vesting_rules      24 months
  evm_representation ERC-20
  evm_contract       0xA19c…B3C5
  revision           07
}`

export const TITLE_RECORD_LINES = [
  ['LEMO_TITLE {', ''],
  ['  title_id', '0x7f3a…c19e'],
  ['  native_asset', 'POT'],
  ['  backing_amount', '100.00'],
  ['  native_owner', '5Grw…utQY'],
  ['  identity_status', 'verified'],
  ['  vesting_rules', '24 months'],
  ['  evm_representation', 'ERC-20'],
  ['  evm_contract', '0xA19c…B3C5'],
  ['  revision', '07'],
  ['}', ''],
] as const
