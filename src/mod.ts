import { DependencyContainer } from "tsyringe";
import { Ilogger } from "@spt-aki/models/spt/utils/Ilogger";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ILocationData } from "@spt-aki/models/spt/server/ILocations";

import * as ammoConfig from "../config/ammoConfig.json"

class ModdedAmmoBalancingPatch implements IPostDBLoadMod
{
	private logger: Ilogger;
	public mod: string;
    public modShortName: string;

	constructor() {
        this.mod = "MusicManiac-ModdedAmmoBalancingPatch";
        this.modShortName = "ModdedAmmoBalancingPatch";
    }

	public postDBLoad ( container: DependencyContainer ): void 
	{
		// Get the logger from the server container.
		this.logger = container.resolve<Ilogger>("WinstonLogger");
		const logger = this.logger;
		logger.info(`[${this.modShortName}] ${this.mod} started loading`);
		// Get database from server.
		const db = container.resolve<DatabaseServer>( "DatabaseServer" );


		// Get tables from database
		let tables = db.getTables();
		// Get item database from tables
		const itemDB = tables.templates.items;
		const handbook = tables.templates.handbook;
		const fleaPriceTable = tables.templates.prices;
		const traders = tables.traders;
		const staticAmmo = tables.loot.staticAmmo;
		const staticLoot = tables.loot.staticLoot;

		let ammosToAddToLootTables: { [originId: string]: { [newAmmo: string]: number } } = {};

		for (const ammoKey in ammoConfig.ammos) {
			const ammo = ammoConfig.ammos[ammoKey];
			if (itemDB[ammoKey]) {
				if (ammo?.spawnRelativeProbability !== undefined) {
					const ammoCaliber = itemDB[ammoKey]._props.Caliber;
					if (staticAmmo[ammoCaliber]) {
						const spawnRelativeProbabilityKey = Object.keys(ammo.spawnRelativeProbability)[0];
						if (spawnRelativeProbabilityKey !== "idHere") {
							const relativeProbability = ammo.spawnRelativeProbability[spawnRelativeProbabilityKey];
							if (!ammosToAddToLootTables[spawnRelativeProbabilityKey]) {
								ammosToAddToLootTables[spawnRelativeProbabilityKey] = {};
								ammosToAddToLootTables[spawnRelativeProbabilityKey][spawnRelativeProbabilityKey] = 1;
							}
							ammosToAddToLootTables[spawnRelativeProbabilityKey][ammoKey] = relativeProbability;
							//logger.warning(`[${this.modShortName}] ammosToAddToLootTables: ${JSON.stringify(ammosToAddToLootTables)}`);
						}		
					} else {
						logger.warning(`[${this.modShortName}] caliber of ammo ${ammoKey} was not found in staticAmmo`);
					}
				}

			}
		}

		for (const originId in ammosToAddToLootTables) {
			const sum = Object.values(ammosToAddToLootTables[originId]).reduce((acc, weight) => acc + weight, 0);
			// Check if sum is non-zero to avoid division by zero
			if (sum !== 0) {
				for (const key in ammosToAddToLootTables[originId]) {
					ammosToAddToLootTables[originId][key] /= sum;
					ammosToAddToLootTables[originId][key] += 0.1;
				}
			}
		}

		//logger.warning(`[${this.modShortName}] ammosToAddToLootTables: ${JSON.stringify(ammosToAddToLootTables)}`);

		let staticAmmoCounter = 0;
		let staticLootCounter = 0;
		let mapSpawns = 0;
		for (const originId in ammosToAddToLootTables) {
			// staticAmmo
			const ammoCaliber = itemDB[originId]._props.Caliber;
			if (staticAmmo[ammoCaliber]) {
				const originIndex = staticAmmo[ammoCaliber].findIndex(entry => entry.tpl === originId);
				if (originIndex !== -1) {
					const originProbability = staticAmmo[ammoCaliber][originIndex].relativeProbability;
					for (const newAmmo in ammosToAddToLootTables[originId]) {
						//logger.warning(`[${this.modShortName}] newAmmo: ${newAmmo}`);
						const newAmmoIndex = staticAmmo[ammoCaliber].findIndex(entry => entry.tpl === newAmmo);
						const spawnRelativeProbability = ammosToAddToLootTables[originId][newAmmo];
						
						if (newAmmoIndex !== -1) {
							staticAmmo[ammoCaliber][newAmmoIndex].relativeProbability = Math.round(originProbability * spawnRelativeProbability);
							//logger.warning(`[${this.modShortName}] relative prob for ${staticAmmo[ammoCaliber][newAmmoIndex].tpl}: ${originProbability} * ${spawnRelativeProbability} = ${staticAmmo[ammoCaliber][newAmmoIndex].relativeProbability}`);
						} else {
							staticAmmo[ammoCaliber].push({
								tpl: newAmmo,
								relativeProbability: Math.round(originProbability * spawnRelativeProbability)
							});
							staticAmmoCounter++;
						}
					}
				} else {
					logger.error(`[${this.modShortName}] cant find ${originId} from ammosToAddToLootTables in ${ammoCaliber} in staticAmmo`);
				}
				
			}

			// staticLoot
			for (const container in staticLoot) {
				const originIndex = staticLoot[container].itemDistribution.findIndex(entry => entry.tpl === originId);
				if (originIndex !== -1) {
					//logger.warning(`[${this.modShortName}] found origin: ${staticLoot[container].itemDistribution[originIndex].tpl} in container ${container} items distribution`);
					const originProbability = staticLoot[container].itemDistribution[originIndex].relativeProbability
					//staticLoot[container].itemDistribution[originIndex].relativeProbability = Math.round(originProbability * ammosToAddToLootTables[originId][originId]);
					for (const newAmmo in ammosToAddToLootTables[originId]) {
						const newAmmoIndex = staticLoot[container].itemDistribution.findIndex(entry => entry.tpl === newAmmo);
						const spawnRelativeProbability = ammosToAddToLootTables[originId][newAmmo];
						if (newAmmoIndex !== -1) {
							//logger.warning(`[${this.modShortName}] found existing entry for ${newAmmo} in container ${container} items distribution, adjusting weight.`);
							staticLoot[container].itemDistribution[newAmmoIndex].relativeProbability = Math.round(originProbability * spawnRelativeProbability)
							//logger.warning(`[${this.modShortName}] existing entry for ${newAmmo} in container ${container} weight: ${staticLoot[container].itemDistribution[newAmmoIndex].relativeProbability}`);
						} else {
							//logger.warning(`[${this.modShortName}] didn't find existing entry for ${newAmmo} in container ${container} items distribution`);
							staticLoot[container].itemDistribution.push({
								tpl: newAmmo,
								relativeProbability: Math.round(originProbability * spawnRelativeProbability)
							})
							staticLootCounter++;
							//const lastElement = staticLoot[container].itemDistribution[staticLoot[container].itemDistribution.length - 1];
							//logger.warning(`[${this.modShortName}] pushed element: ${JSON.stringify(lastElement)}`);
						}
					}
				}
			}
			
			// maps
			const maps = ["bigmap", "woods", "factory4_day", "factory4_night", "interchange", "laboratory", "lighthouse", "rezervbase", "shoreline", "tarkovstreets"];
			for (const [name, temp] of Object.entries(tables.locations)) {
				const mapdata : ILocationData = temp;
				for (const Map of maps) {
					if (name === Map) {
						for (const point of mapdata.looseLoot.spawnpoints) {
							for (const itm of point.template.Items) {
								if (itm._tpl == originId) {
									for (const newAmmo in ammosToAddToLootTables[originId]) {
										if (newAmmo !== originId) {
											const lootComposedKey = newAmmo +"_composedkey"
											const originalItemID = itm._id;
											const originalStack = itm.upd.StackObjectsCount;
											let originRelativeProb: any;
											for (const dist of point.itemDistribution) {
												if (dist.composedKey.key == originalItemID) {
													originRelativeProb = dist.relativeProbability;
													point.template.Items.push({
														_id: lootComposedKey,
														_tpl: newAmmo,
														upd: {
															StackObjectsCount : originalStack
														}
													})
													point.itemDistribution.push({
														composedKey: {
															key: lootComposedKey
														},
														relativeProbability: Math.max(Math.round(originRelativeProb * ammosToAddToLootTables[originId][newAmmo]), 1)
													})
													mapSpawns++;
													logger.warning(`[${this.modShortName}] found originId ${originId} in map ${name} in spawn point ${JSON.stringify(point)}`);
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
			
		}

		logger.success(`[${this.modShortName}] added ${staticAmmoCounter} ammos to staticAmmo`);
		logger.success(`[${this.modShortName}] added ${staticLootCounter} entries to staticLoot tables`);
		logger.success(`[${this.modShortName}] added ${mapSpawns} entries to map-specific tables`);

		

		for (const ammoKey in ammoConfig.ammos) {
			const ammo = ammoConfig.ammos[ammoKey];
			if (itemDB[ammoKey]) {
				if (itemDB[ammoKey]._props) {
					if (ammo?.CanRequireOnRagfair !== undefined) {
						itemDB[ammoKey]._props.CanRequireOnRagfair = ammo.CanRequireOnRagfair;
					}
					if (ammo?.CanSellOnRagfair !== undefined) {
						itemDB[ammoKey]._props.CanSellOnRagfair = ammo.CanSellOnRagfair;
					}
				}
	
				if (ammo?.RemoveFromTraders !== undefined) {
					for (const traderID of ammo.RemoveFromTraders) {
						// Find the index of the item with the matching _tpl in the trader's items
						const trader = traders[traderID];
						if (trader && trader.assort && trader.assort.items) {
							const itemIndex = trader.assort.items.findIndex(item => item._tpl === ammoKey);
							// Check if the item was found (index is not -1)
							if (itemIndex !== -1) {
								// Remove the item from the trader's items array
								trader.assort.items.splice(itemIndex, 1);
							} else {
								logger.warning(`[${this.modShortName}] Can't find ${ammoKey} in trader ${traderID}`);
							}
						} else {
							logger.warning(`[${this.modShortName}] trader ${trader} was not found in traders`);
						}
					}
				}

				if (ammo?.ChangeTraderPrice !== undefined) {
					for (const traderID in ammo.ChangeTraderPrice) {
						const trader = traders[traderID];
						if (trader?.assort?.items !== undefined) {
							const itemIndex = trader.assort.items.findIndex(item => item._tpl === ammoKey);
							if (itemIndex !== -1) {
								const barterId = trader.assort.items[itemIndex]._id;
								if (trader.assort.barter_scheme[barterId]?.[0]?.[0]?.count !== undefined) {
									trader.assort.barter_scheme[barterId][0][0].count = ammo.ChangeTraderPrice[traderID];
								} else {
									logger.warning(`[${this.modShortName}] Can't find ${ammoKey} barters_scheme in trader ${traderID}`);
								}								
							} else {
								logger.warning(`[${this.modShortName}] Can't find ${ammoKey} in trader ${traderID}`);
							}
						} else {
							logger.warning(`[${this.modShortName}] Trader ${traderID} was not found in traders`);
						}
					}
				}
	
				const handbookEntry = handbook.Items.find(item => item.Id === ammoKey);
				if (ammo?.handbookPrice !== undefined) {
					if (handbookEntry) {
						handbookEntry.Price = ammo.handbookPrice;
					} else {
						logger.warning(`[${this.modShortName}] ammo ${ammoKey} was not found in handbook`);
					}
				}

				if (ammo?.fleaPrice !== undefined) {
					fleaPriceTable[ammoKey] = ammo.fleaPrice;
				}

				if (!itemDB[ammoKey]._props.CanRequireOnRagfair && !itemDB[ammoKey]._props.CanSellOnRagfair) {
					delete fleaPriceTable[ammoKey];
				}
			} else {
				logger.warning(`[${this.modShortName}] ammo ${ammoKey} was not found in database`);
			}
		}


		logger.success(`[${this.modShortName}] ${this.mod} finished loading`);
	}
}

module.exports = { mod: new ModdedAmmoBalancingPatch() }