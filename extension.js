import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const STYLE_CLASSES = {
    PANEL_BOX: 'panel-status-menu-box',
    SOURCE_LANG: 'vocab-source-lang',
    TARGET_LANG: 'vocab-target-lang',
    TICK_BUTTON: 'vocab-tick-button',
    IMPORT_BUTTON: 'vocab-import-button',
    DIALOG: 'vocab-import-dialog',
    DIALOG_HEADLINE: 'vocab-import-headline',
    DIALOG_DESCRIPTION: 'vocab-import-description',
    DIALOG_BOX: 'vocab-import-box'
};

const FILE_NAMES = {
    VOCABULARY: 'vocabulary.json',
    SETTINGS: 'settings.json'
};

const DEFAULT_VOCABULARY = [
    { "en": "winner", "tr": "kazanan" },
    { "en": "hello", "tr": "merhaba" },
    { "en": "world", "tr": "dünya" },
    { "en": "book", "tr": "kitap" },
    { "en": "to learn", "tr": "öğrenmek" }
];

const ImportDialog = GObject.registerClass(
class ImportDialog extends ModalDialog.ModalDialog {
    _init(extension) {
        super._init({
            styleClass: STYLE_CLASSES.DIALOG
        });
        
        this._extension = extension;
        this._buildLayout();
    }
    
    _buildLayout() {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: STYLE_CLASSES.DIALOG_BOX
        });
        
        box.add_child(new St.Label({
            text: 'Import Vocabulary File',
            style_class: STYLE_CLASSES.DIALOG_HEADLINE
        }));
        
        box.add_child(new St.Label({
            text: 'Please select a JSON file with the following structure:\n' +
                  '[{ "lang1": "word1", "lang2": "translation1" }, ...]\n\n' +
                  'For example: [{ "es": "hola", "en": "hello" }]\n\n'+
                  '! Your file name must be "vocabulary.json"',
            style_class: STYLE_CLASSES.DIALOG_DESCRIPTION
        }));
        
        this.contentLayout.add_child(box);
        
        this.setButtons([
            {
                label: 'Cancel',
                action: () => this.close(),
                key: Clutter.KEY_Escape
            },
            {
                label: 'Select File',
                action: () => this._selectFile()
            }
        ]);
    }
    
    _selectFile() {
        this.close();
        
        try {
            const extensionDir = this._extension.dir.get_path();
            const uri = `file://${extensionDir}`;
            Gio.AppInfo.launch_default_for_uri(uri, null);
            
            this._showPopupMessage(
                'Import Vocabulary File',
                'Please copy your JSON "vocabulary.json" file.\n\n' +
                'Then "paste" and "replace" in the opened file.\n\n'+
                'Then click on "Reload Vocabulary File".'
            );
        } catch (error) {
            logError(error);
            this._showError('Could not open file manager. Please copy your JSON file to:\n' + 
                           `${this._extension.dir.get_path()}/vocabulary.json`);
        }
    }
    
    _showPopupMessage(title, message) {
        let messageDialog = new ModalDialog.ModalDialog();
        
        let content = new St.BoxLayout({
            vertical: true,
            style_class: 'message-dialog-content'
        });
        
        content.add_child(new St.Label({
            text: title,
            style_class: 'message-dialog-title'
        }));
        
        content.add_child(new St.Label({
            text: message,
            style_class: 'message-dialog-description'
        }));
        
        messageDialog.contentLayout.add_child(content);
        
        messageDialog.setButtons([{
            label: 'OK',
            action: () => messageDialog.close(),
            key: Clutter.KEY_Return
        }]);
        
        messageDialog.open();
    }
    
    _showError(message) {
        let errorDialog = new ModalDialog.ModalDialog();
        
        let content = new St.BoxLayout({
            vertical: true
        });
        
        content.add_child(new St.Icon({
            icon_name: 'dialog-error-symbolic',
            style_class: 'error-icon',
            icon_size: 48
        }));
        
        content.add_child(new St.Label({
            text: message,
            style_class: 'error-label'
        }));
        
        errorDialog.contentLayout.add_child(content);
        
        errorDialog.setButtons([{
            label: 'OK',
            action: () => errorDialog.close(),
            key: Clutter.KEY_Return
        }]);
        
        errorDialog.open();
    }
});

export default class VocabExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._timeoutId = null;
        this._menu = null;
        this._indicator = null;
        this._vocabulary = [];
        this._sourceLangLabel = null;
        this._targetLangLabel = null;
        this._dashLabel = null;
        this._tickButton = null;
        this._importButton = null;
        this._panelBox = null;
        
        this._settings = {
            currentIndex: 0,
            knownWords: [],
            lastUsedDate: null,
            sourceLang: 'en',
            targetLang: 'tr'
        };
    }
    
    enable() {
        const userDataDir = GLib.get_user_data_dir();
        this._userExtensionDir = GLib.build_filenamev([userDataDir, 'gnome-shell', 'extensions', this.uuid]);
        
        const userExtDir = Gio.File.new_for_path(this._userExtensionDir);
        if (!userExtDir.query_exists(null)) {
            try {
                userExtDir.make_directory_with_parents(null);
            } catch (e) {
                logError(e);
            }
        }
        
        this._loadSettings();
        this._loadVocabulary();
        
        const today = new Date().toDateString();
        if (this._settings.lastUsedDate !== today) {
            this._settings.lastUsedDate = today;
            this._saveSettings();
        }
        
        this._createUI();
        this._showCurrentWord();
        this._startWordRotation();
    }
    
    disable() {
        this._cleanup();
    }
    
    _cleanup() {
        this._saveSettings();
        
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        if (this._sourceLangLabel) {
            this._sourceLangLabel.destroy();
            this._sourceLangLabel = null;
        }
        
        if (this._targetLangLabel) {
            this._targetLangLabel.destroy();
            this._targetLangLabel = null;
        }
        
        if (this._dashLabel) {
            this._dashLabel.destroy();
            this._dashLabel = null;
        }
        
        if (this._tickButton) {
            this._tickButton.destroy();
            this._tickButton = null;
        }
        
        if (this._importButton) {
            this._importButton.destroy();
            this._importButton = null;
        }
        
        if (this._panelBox) {
            this._panelBox.destroy();
            this._panelBox = null;
        }
        
        this._vocabulary = null;
        this._settings = null;
    }
    
    _createUI() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        
        this._panelBox = new St.BoxLayout({
            style_class: STYLE_CLASSES.PANEL_BOX
        });
        
        this._sourceLangLabel = new St.Label({
            text: 'Loading...',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: STYLE_CLASSES.SOURCE_LANG
        });
        
        this._targetLangLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: STYLE_CLASSES.TARGET_LANG
        });
        
        this._dashLabel = new St.Label({ 
            text: ' - ',
            y_align: Clutter.ActorAlign.CENTER 
        });
        
        this._tickButton = new St.Button({
            style_class: STYLE_CLASSES.TICK_BUTTON,
            child: new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                style_class: 'system-status-icon'
            })
        });
        
        this._importButton = new St.Button({
            style_class: STYLE_CLASSES.IMPORT_BUTTON,
            child: new St.Icon({
                icon_name: 'document-open-symbolic',
                style_class: 'system-status-icon'
            })
        });
        
        this._tickButton.connect('clicked', () => this._onTickButtonClicked());
        this._importButton.connect('clicked', () => this._onImportButtonClicked());
        
        this._panelBox.add_child(this._sourceLangLabel);
        this._panelBox.add_child(this._dashLabel);
        this._panelBox.add_child(this._targetLangLabel);
        this._panelBox.add_child(this._tickButton);
        this._panelBox.add_child(this._importButton);
        
        this._indicator.add_child(this._panelBox);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }
    
    _loadVocabulary() {
        try {
            let file = Gio.File.new_for_path(`${this._userExtensionDir}/${FILE_NAMES.VOCABULARY}`);
            
            if (!file.query_exists(null)) {
                file = Gio.File.new_for_path(`${this.dir.get_path()}/${FILE_NAMES.VOCABULARY}`);
            }
            
            if (file.query_exists(null)) {
                const [, contents] = file.load_contents(null);
                this._vocabulary = JSON.parse(new TextDecoder().decode(contents));
                
                if (this._vocabulary.length > 0) {
                    const firstEntry = this._vocabulary[0];
                    const langs = Object.keys(firstEntry);
                    
                    if (langs.length >= 2) {
                        this._settings.sourceLang = langs[0];
                        this._settings.targetLang = langs[1];
                        this._saveSettings();
                    }
                }
            } else {
                this._vocabulary = DEFAULT_VOCABULARY;
                this._saveVocabulary();
            }
        } catch (error) {
            logError(error);
            this._vocabulary = DEFAULT_VOCABULARY;
        }
    }
    
    _saveVocabulary() {
        try {
            const file = Gio.File.new_for_path(`${this._userExtensionDir}/${FILE_NAMES.VOCABULARY}`);
            
            const content = JSON.stringify(this._vocabulary, null, 2);
            file.replace_contents(
                new TextEncoder().encode(content),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            logError(error);
        }
    }
    
    _loadSettings() {
        try {
            const file = Gio.File.new_for_path(`${this._userExtensionDir}/${FILE_NAMES.SETTINGS}`);
            
            if (file.query_exists(null)) {
                const [, contents] = file.load_contents(null);
                const savedSettings = JSON.parse(new TextDecoder().decode(contents));
                
                this._settings = {
                    ...this._settings,
                    ...savedSettings
                };
            }
        } catch (error) {
            logError(error);
        }
    }
    
    _saveSettings() {
        try {
            const file = Gio.File.new_for_path(`${this._userExtensionDir}/${FILE_NAMES.SETTINGS}`);
            
            const content = JSON.stringify(this._settings, null, 2);
            file.replace_contents(
                new TextEncoder().encode(content),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            logError(error);
        }
    }
    
    _findNextUnknownWordIndex() {
        let index = this._settings.currentIndex;
        
        while (index < this._vocabulary.length) {
            if (!this._settings.knownWords.includes(index)) {
                return index;
            }
            index++;
        }
        
        index = 0;
        while (index < this._settings.currentIndex) {
            if (!this._settings.knownWords.includes(index)) {
                return index;
            }
            index++;
        }
        
        return -1;
    }
    
    _showCurrentWord() {
        const nextIndex = this._findNextUnknownWordIndex();
        
        if (nextIndex === -1 || this._vocabulary.length === 0) {
            this._sourceLangLabel.text = 'All words';
            this._targetLangLabel.text = 'learned! 🎉';
            return;
        }
        
        this._settings.currentIndex = nextIndex;
        const currentWord = this._vocabulary[this._settings.currentIndex];
        
        this._sourceLangLabel.text = currentWord[this._settings.sourceLang] || 'Unknown';
        this._targetLangLabel.text = currentWord[this._settings.targetLang] || 'Unknown';
    }
    
    _startWordRotation() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
        }
        
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            this._settings.currentIndex = (this._settings.currentIndex + 1) % this._vocabulary.length;
            this._showCurrentWord();
            this._saveSettings();
            return GLib.SOURCE_CONTINUE;
        });
    }
    
    _onTickButtonClicked() {
        if (!this._settings.knownWords.includes(this._settings.currentIndex)) {
            this._settings.knownWords.push(this._settings.currentIndex);
            this._saveSettings();
        }
        
        this._settings.currentIndex = (this._settings.currentIndex + 1) % this._vocabulary.length;
        this._showCurrentWord();
    }
    
    _onImportButtonClicked() {
        if (this._menu && this._menu.isOpen) {
            this._menu.close();
            return;
        }
        if (this._menu) {
            this._menu.destroy();
        }
        
        this._menu = new PopupMenu.PopupMenu(this._indicator, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(this._menu.actor);
        
        this._addMenuItem('Import Vocabulary File', () => {
            new ImportDialog(this).open();
        });
        
        this._addMenuItem('Reload Vocabulary File', () => {
            this._reloadVocabulary();
        });
        
        this._menu.open();
    }
    
    _addMenuItem(label, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', callback);
        this._menu.addMenuItem(item);
    }
    
    _reloadVocabulary() {
        this._loadVocabulary();
        this._showCurrentWord();
        Main.notify('Vocabulary Reloaded', 'Successfully reloaded vocabulary file.');
    }
    
    _openExtensionDirectory() {
        try {
            const extensionDir = this._userExtensionDir || this.dir.get_path();
            const uri = `file://${extensionDir}`;
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (error) {
            logError(error);
        }
    }
}