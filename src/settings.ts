import { App, Plugin, PluginSettingTab, Command, Setting } from 'obsidian';

export interface SourceModeDecoratorSettings {
    splitterPattern: string;
    exportCommandId: string;
}

export const DEFAULT_SETTINGS: SourceModeDecoratorSettings = {
    splitterPattern: "<!--~-->",
    exportCommandId: ""
};

export interface ObsidianApp extends App {
    commands: {
        executeCommandById(id: string): void;
        findCommand(id: string): Command | undefined;
        commands: Record<string, Command>;
    };
}

export interface ISMDPlugin extends Plugin {
    settings: SourceModeDecoratorSettings;
    saveSettings(): Promise<void>;
}

export class SourceModeDecoratorSettingTab extends PluginSettingTab {
    plugin: ISMDPlugin;

    constructor(app: App, plugin: ISMDPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Splitter pattern')
            .setDesc('Pattern used for the clipboard split indicator.')
            .addText(text => text
                .setPlaceholder('<!--~-->')
                .setValue(this.plugin.settings.splitterPattern)
                .onChange(async (value) => {
                    this.plugin.settings.splitterPattern = value;
                    await this.plugin.saveSettings();
                }));

        const appCommands = (this.app as ObsidianApp).commands;
        const commandsDict = appCommands?.commands || {};
        const allCommands: Command[] = Object.values(commandsDict);
        allCommands.sort((a, b) => a.name.localeCompare(b.name));

        const options: Record<string, string> = { "": "--- none ---" };
        allCommands.forEach(cmd => { options[cmd.id] = cmd.name; });

        new Setting(containerEl)
            .setName('Export command')
            .setDesc('Select the command to trigger when the export button is clicked.')
            .addDropdown(dropdown => dropdown
                .addOptions(options)
                .setValue(this.plugin.settings.exportCommandId)
                .onChange(async (value) => {
                    this.plugin.settings.exportCommandId = value;
                    await this.plugin.saveSettings();
                }));
    }
}
