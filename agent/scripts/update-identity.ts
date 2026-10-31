// Points the agent's ERC-8004 identity at what it is today. The registration file is inlined as a
// data: URI, so what the registry says can be read without trusting any server.
import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { feeFields } from "../src/chain.js";
import { loadConfig } from "../src/config.js";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const abi = parseAbi(["function setAgentURI(uint256 agentId, string newURI)", "function ownerOf(uint256 tokenId) view returns (address)"]);

const cfg = loadConfig();
if (!cfg.privateKey || !cfg.agentId) throw new Error("set AGENT_PRIVATE_KEY and AGENT_ID");
const registration = await (await fetch(`${cfg.publicUrl}/.well-known/agent-registration.json`)).json();
const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString("base64")}`;

const account = privateKeyToAccount(cfg.privateKey);
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
const owner = await pub.readContract({ address: REGISTRY, abi, functionName: "ownerOf", args: [cfg.agentId] });
if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`agent ${cfg.agentId} is owned by ${owner}`);
const base = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const wallet = cfg.attributionTag ? base.extend(withAttribution(cfg.attributionTag)) : base;
const hash = await wallet.writeContract({ address: REGISTRY, abi, functionName: "setAgentURI", args: [cfg.agentId, uri], ...feeFields(cfg) });
await pub.waitForTransactionReceipt({ hash });
console.log(`agent ${cfg.agentId} now describes "${registration.name}": ${cfg.explorer}/tx/${hash}`);
