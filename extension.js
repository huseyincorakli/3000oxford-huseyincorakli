import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class VocabExtension extends Extension {
    enable() {
        this._settings = {
            currentIndex: 0,
            knownWords: [],
            lastUsedDate: null
        };
        
        this._loadSettings();
        this._loadVocabulary();
        
        const today = new Date().toDateString();
        if (this._settings.lastUsedDate !== today) {
            this._settings.lastUsedDate = today;
            this._saveSettings();
        }
        
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        
        this._panelBox = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });
        
        this._englishLabel = new St.Label({
            text: 'Loading...',
            y_align: 2,  
            style_class: 'vocab-english'
        });
        
        this._dashLabel = new St.Label({
            text: ' - ',
            y_align: 2
        });
        
        this._turkishLabel = new St.Label({
            text: '',
            y_align: 2,
            style_class: 'vocab-turkish'
        });
        
        this._tickButton = new St.Button({
            style_class: 'vocab-tick-button',
            child: new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                style_class: 'system-status-icon'
            })
        });
        
        this._tickButton.connect('clicked', this._onTickButtonClicked.bind(this));
        
        this._panelBox.add_child(this._englishLabel);
        this._panelBox.add_child(this._dashLabel);
        this._panelBox.add_child(this._turkishLabel);
        this._panelBox.add_child(this._tickButton);
        this._indicator.add_child(this._panelBox);
        
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        
        this._showCurrentWord();
        this._startWordRotation();
    }
    
    disable() {
        this._saveSettings();
        
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        this._indicator?.destroy();
        this._indicator = null;
    }
    
    _loadVocabulary() {
        try {
            const dir = this.dir.get_path();
            const file = Gio.File.new_for_path(`${dir}/vocabulary.json`);
            
            if (file.query_exists(null)) {
                const [, contents] = file.load_contents(null);
                this._vocabulary = JSON.parse(new TextDecoder().decode(contents));
            } else {
                this._vocabulary = [
                    { "tr": "kazanan", "en": "winner" },
                    { "tr": "merhaba", "en": "hello" },
                    { "tr": "dünya", "en": "world" },
                    { "tr": "kitap", "en": "book" },
                    { "tr": "öğrenmek", "en": "to learn" }
                ];
                
                this._saveVocabulary();
            }
        } catch (error) {
            logError(error);
            this._vocabulary = [];
        }
    }
    
    _saveVocabulary() {
        try {
            const dir = this.dir.get_path();
            const file = Gio.File.new_for_path(`${dir}/vocabulary.json`);
            
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
            const dir = this.dir.get_path();
            const file = Gio.File.new_for_path(`${dir}/settings.json`);
            
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
            const dir = this.dir.get_path();
            const file = Gio.File.new_for_path(`${dir}/settings.json`);
            
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
        
        if (nextIndex === -1) {
            // All words are known
            this._englishLabel.text = 'All words';
            this._dashLabel.text = ' ';
            this._turkishLabel.text = 'learned! 🎉';
            this._tickButton.hide();
            return;
        }
        
        this._settings.currentIndex = nextIndex;
        const currentWord = this._vocabulary[this._settings.currentIndex];
        
        this._englishLabel.text = currentWord.en;
        this._dashLabel.text = ' - ';
        this._turkishLabel.text = currentWord.tr;
        this._tickButton.show();
    }
    
    _startWordRotation() {
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            this._settings.currentIndex++;
            if (this._settings.currentIndex >= this._vocabulary.length) {
                this._settings.currentIndex = 0;
            }
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
        
        this._settings.currentIndex++;
        if (this._settings.currentIndex >= this._vocabulary.length) {
            this._settings.currentIndex = 0;
        }
        this._showCurrentWord();
    }
}