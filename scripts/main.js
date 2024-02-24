import ChatHandler from './ui/chat-handler.js';
import Constants from './constants.js';
import Controls from './ui/controls.js';
import EffectDefinitionsDelegate from './systems/effect-definitions-delegate.js';
import EffectHelpers from './effects/effect-helpers.js';
import EffectInterface from './effect-interface.js';
import FoundryHelpers from './util/foundry-helpers.js';
import HandlebarHelpers from './ui/handlebar-helpers.js';
import MacroHandler from './ui/macro-handler.js';
import Settings from './settings.js';
import StatusEffects from './effects/status-effects.js';
import TextEnrichers from './ui/text-enrichers.js';
import { addNestedEffectsToEffectConfig } from './ui/add-nested-effects-to-effect-config.js';
import { libWrapper } from './lib/shim.js';
import { removeCustomItemFromSidebar } from './ui/remove-custom-item-from-sidebar.js';

/**
 * Initialize the settings and handlebar helpers
 */
Hooks.once('init', () => {
  new Settings().registerSettings();
  new HandlebarHelpers().registerHelpers();
  new TextEnrichers().initialize();
});

/**
 * Handle setting up the API when socket lib is ready
 */
Hooks.once('socketlib.ready', () => {
  game.dfreds = game.dfreds || {};

  game.dfreds.effects = new EffectDefinitionsDelegate();
  game.dfreds.effectInterface = new EffectInterface();
  game.dfreds.statusEffects = new StatusEffects();
});

/**
 * Handle creating the custom effects ID on ready
 */
Hooks.once('ready', async () => {
  const settings = new Settings();

  if (!settings.customEffectsItemId) {
    const item = await CONFIG.Item.documentClass.create({
      name: 'Custom Convenient Effects',
      img: 'modules/dfreds-convenient-effects/images/magic-palm.svg',
      type: 'consumable',
    });

    await settings.setCustomEffectsItemId(item.id);
  }

  if (game.settings.get(Constants.MODULE_ID, Settings.SHOW_SIDEBAR_EFFECTS)) {
    const sidebarWidth = parseFloat(getComputedStyle(document.querySelector("#sidebar #sidebar-tabs")).getPropertyValue("--sidebar-tab-width").replace("px", "").trim());
    document.querySelector("#sidebar #sidebar-tabs").style.setProperty("--sidebar-tab-width", sidebarWidth - 2 + "px");
    const app = new ConvenientEffectsApp();
    app.render(false);
    app.tabName = "effects";
    ui.effects = app;
    $(document).on("click", "#sidebar #sidebar-tabs [data-tab='effects']", (event) => {;
      ui.effects.render(true);
    });
  }
});

/**
 * Handle initializing everything
 */
Hooks.once(`${Constants.MODULE_ID}.initialize`, async () => {
  game.dfreds.effectInterface.initialize();
  game.dfreds.effects.initialize();
  game.dfreds.statusEffects.initialize();

  Hooks.callAll(`${Constants.MODULE_ID}.ready`);
});

/**
 * Handle setting up the lib wrapper overrides
 */
Hooks.once('setup', () => {
  libWrapper.register(
    Constants.MODULE_ID,
    'TokenHUD.prototype._onToggleEffect',
    function (wrapper, ...args) {
      game.dfreds.statusEffects.onToggleEffect({
        token: this.object,
        wrapper,
        args,
      });
    }
  );

  libWrapper.register(
    Constants.MODULE_ID,
    'TokenHUD.prototype._getStatusEffectChoices',
    function (wrapper, ...args) {
      const token = this.object;
      return game.dfreds.statusEffects.getStatusEffectChoices({
        token,
        wrapper,
        args,
      });
    }
  );

  libWrapper.register(
    Constants.MODULE_ID,
    'TokenHUD.prototype.refreshStatusIcons',
    function (wrapper, ...args) {
      const tokenHud = this;
      game.dfreds.statusEffects.refreshStatusIcons(tokenHud);
    }
  );

  Hooks.callAll(`${Constants.MODULE_ID}.initialize`);
});

Hooks.on('changeSidebarTab', (directory) => {
  removeCustomItemFromSidebar(directory);
});

Hooks.on('renderItemDirectory', (directory) => {
  removeCustomItemFromSidebar(directory);
});

/**
 * Handle adding new controls
 */
Hooks.on('getSceneControlButtons', (controls) => {
  new Controls().initializeControls(controls);
});

/**
 * Handle creating a chat message if an effect is added
 */
Hooks.on('preCreateActiveEffect', (activeEffect, _config, _userId) => {
  const effectHelpers = new EffectHelpers();
  if (
    !effectHelpers.isConvenient(activeEffect) ||
    !(activeEffect?.parent instanceof Actor)
  )
    return;

  const chatHandler = new ChatHandler();
  chatHandler.createChatForEffect({
    effectName: activeEffect?.name,
    reason: 'Applied to',
    actor: activeEffect?.parent,
    isCreateActiveEffect: true,
  });
});

/**
 * Handle when an active effect is created
 */
Hooks.on('createActiveEffect', (activeEffect, _config, _userId) => {
  const settings = new Settings();
  if (activeEffect.parent.id == settings.customEffectsItemId) {
    // Re-render the app if open and a new effect is added to the custom item
    const foundryHelpers = new FoundryHelpers();
    foundryHelpers.renderConvenientEffectsAppIfOpen();
  }
});

/**
 * Handle re-rendering the app if it is open and an update occurs
 */
Hooks.on('updateActiveEffect', (activeEffect, _config, _userId) => {
  const settings = new Settings();
  if (activeEffect.parent.id == settings.customEffectsItemId) {
    const effectHelpers = new EffectHelpers();
    effectHelpers.updateStatusId(activeEffect);

    const foundryHelpers = new FoundryHelpers();
    foundryHelpers.renderConvenientEffectsAppIfOpen();
  }
});

/**
 * Handle creating a chat message if an effect has expired or was removed
 */
Hooks.on('preDeleteActiveEffect', (activeEffect, _config, _userId) => {
  const effectHelpers = new EffectHelpers();
  if (
    !effectHelpers.isConvenient(activeEffect) ||
    !(activeEffect?.parent instanceof Actor)
  )
    return;

  const isExpired =
    activeEffect?.duration?.remaining !== null &&
    activeEffect?.duration?.remaining <= 0;

  const chatHandler = new ChatHandler();
  chatHandler.createChatForEffect({
    effectName: activeEffect?.name,
    reason: isExpired ? 'Expired from' : 'Removed from',
    actor: activeEffect?.parent,
    isCreateActiveEffect: false,
  });
});

/**
 * Handle removing any actor data changes when an active effect is deleted from an actor
 */
Hooks.on('deleteActiveEffect', (activeEffect, _config, _userId) => {
  const settings = new Settings();
  if (activeEffect.parent.id == settings.customEffectsItemId) {
    const foundryHelpers = new FoundryHelpers();
    foundryHelpers.renderConvenientEffectsAppIfOpen();
  }

  const effectHelpers = new EffectHelpers();
  if (
    !effectHelpers.isConvenient(activeEffect) ||
    !(activeEffect?.parent instanceof Actor)
  ) {
    return;
  }

  // Remove effects that were added due to this effect
  const actor = activeEffect.parent;
  const effectIdsFromThisEffect = actor.effects
    .filter(
      (effect) => effect.origin === effectHelpers.getId(activeEffect.name)
    )
    .map((effect) => effect.id);

  if (effectIdsFromThisEffect) {
    actor.deleteEmbeddedDocuments('ActiveEffect', effectIdsFromThisEffect);
  }
});

/**
 * Handle changing the rendered active effect config
 */
Hooks.on(
  'renderActiveEffectConfig',
  async (activeEffectConfig, $html, _data) => {
    const settings = new Settings();

    // Only add nested effects if the effect exists on the custom effect item
    if (
      !activeEffectConfig.object.parent ||
      activeEffectConfig.object.parent.id != settings.customEffectsItemId
    )
      return;
    addNestedEffectsToEffectConfig(activeEffectConfig, $html);
  }
);

/**
 * Handle re-rendering the ConvenientEffectsApp if it is open and a custom convenient active effect sheet is closed
 */
Hooks.on('closeActiveEffectConfig', (activeEffectConfig, _html) => {
  const settings = new Settings();

  // Only re-render if the effect exists on the custom effect
  if (activeEffectConfig.object.parent?.id != settings.customEffectsItemId)
    return;

  const foundryHelpers = new FoundryHelpers();
  foundryHelpers.renderConvenientEffectsAppIfOpen();
});

/**
 * Handle dropping an effect onto the hotbar
 */
Hooks.on('hotbarDrop', (_bar, data, slot) => {
  if (!data.effectName) return;
  delete data.type; // This stops dnd5e from creating its own macro by obscuring that the drop data is an ActiveEffect
  const macroHandler = new MacroHandler();
  macroHandler.createMacro(data, slot);
});

/**
 * Handle dropping an effect onto an actor sheet
 */
Hooks.on('dropActorSheetData', (actor, _actorSheetCharacter, data) => {
  if (!data.effectName) return;

  const effect = game.dfreds.effectInterface.findEffectByName(data.effectName);

  // core will handle the drop since we are not using a nested effect
  if (!game.dfreds.effectInterface.hasNestedEffects(effect)) return;

  game.dfreds.effectInterface.addEffect({
    effectName: data.effectName,
    uuid: actor.uuid,
  });
});

/**
 * Handle adding a button to item cards.
 */
Hooks.on('renderChatMessage', (message, html) => {
  const settings = new Settings();

  // only add button on item cards if configured
  const itemCard = html[0].querySelector('.item-card');
  if (itemCard && settings.addChatButton) {
    // check if this item has a Convenient Effect
    const name = itemCard.querySelector('.item-name')?.textContent;
    if (game.dfreds.effectInterface.findEffectByName(name)) {
      // build a button
      const button = document.createElement('button');
      button.textContent = 'Add Convenient Effect';
      button.onclick = () => game.dfreds.effectInterface.toggleEffect(name);

      // construct empty card-buttons if it doesn't exist (e.g. quick-roll from Ready Set Roll)
      if (!itemCard.querySelector('.card-buttons')) {
        const div = document.createElement('div');
        div.classList.add('card-buttons');

        let cardContent = itemCard.querySelector('.card-content');
        cardContent.insertAdjacentElement('afterend', div);
      }

      // add button to end of card-buttons
      itemCard.querySelector('.card-buttons').append(button);
    }
  }
});

Hooks.on("renderSidebar", (app, html, tabs, c) => {
  if (game.settings.get(Constants.MODULE_ID, Settings.SHOW_SIDEBAR_EFFECTS)) {
    // Ty to arcanist for this
      html.find("#sidebar-tabs a[data-tab='items']").after(`
    <a class="item" data-tab="effects" data-tooltip="Effects" alt="Effects">
              <i class="fas fa-hand-sparkles"></i>
    </a>
    `);
  }
});

// Hook into the sidebar tab rendering
Hooks.on("renderEffectDirectory", (doc, html) => {
	// If we are rendering the "effects" sidebar tab
	if (doc.tabName === "effects") {
		// Create the Effect directory
		createDirectory(html[0]);
	}
});

/**
 * Create the Macro directory in the sidebar
 * @param {HTMLElement} html - The html element of the Macro sidebar tab
 */
const createDirectory = html => {
	// Move Macros directory to sidebar if there isn't already one there
	if (document.querySelectorAll("#effects").length <= 1) document.querySelector("#sidebar").append(html);

	document.querySelector("#effects").classList.add("tab");

	// Make the directory display properly and not all of the time
	html.style.display = "";
};

