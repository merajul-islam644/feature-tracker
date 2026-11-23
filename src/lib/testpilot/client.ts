// TestPilot workbench talks to the SAME tenant through Lattice's
// single blocksClient — no second SDK instance, no separate env.
export { blocksClient } from "@/lib/blocks/client";
