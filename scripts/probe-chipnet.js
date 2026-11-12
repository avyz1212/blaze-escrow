// Connectivity probe: can we reach a chipnet Electrum server from here?
import { ElectrumNetworkProvider, Network } from 'cashscript';

const provider = new ElectrumNetworkProvider(Network.CHIPNET);
try {
  const height = await provider.getBlockHeight();
  console.log(`chipnet reachable, block height: ${height}`);
} catch (e) {
  console.log(`chipnet NOT reachable: ${e.message}`);
  process.exitCode = 1;
}
