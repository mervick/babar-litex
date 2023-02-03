/*
  BaBar LiteX for GNOME Shell 40+
  (c) Andrey Izman 2023
  (c) Francois Thirioux 2021
  Contributors: @mervick, @fthx
  Contributors for original BaBar: @fthx, @wooque, @frandieguez, @kenoh, @justperfection
  License GPL v3
*/


const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;

const Main = imports.ui.main;
const DND = imports.ui.dnd;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Dash = imports.ui.dash;
const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const AppMenu = Main.panel.statusArea.appMenu;
const PanelBox = Main.layoutManager.panelBox;
const WM = global.workspace_manager;

// translation needed to restore Places label, if any
const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;
const N_ = x => x;

// workspaces names from native schema
const WORKSPACES_SCHEMA = "org.gnome.desktop.wm.preferences";
const WORKSPACES_KEY = "workspace-names";

// settings
const RIGHT_CLICK = true;
const MIDDLE_CLICK = false;
const REDUCE_PADDING = true;
const APP_GRID_ICON_NAME = 'view-app-grid-symbolic';
const PLACES_ICON_NAME = 'folder-symbolic';
const FAVORITES_ICON_NAME = 'starred-symbolic';
const FALLBACK_ICON_NAME = 'applications-system-symbolic';
const ICON_SIZE = 16;
const TOOLTIP_VERTICAL_PADDING = 10;
const HIDDEN_OPACITY = 127;
const UNFOCUSED_OPACITY = 255;
const FOCUSED_OPACITY = 255;
const DISPLAY_ACTIVITIES = false;
const DISPLAY_APP_GRID = true;
const DISPLAY_PLACES_ICON = false;
const DISPLAY_FAVORITES = false;
const DISPLAY_WORKSPACES = false;
const DISPLAY_TASKS = true;
const DISPLAY_APP_MENU = false;
const DISPLAY_DASH = true;


let AppGridButton = GObject.registerClass(
class AppGridButton extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'Babar-AppGrid');

    this.app_grid_button = new St.BoxLayout({visible: true, reactive: true, can_focus: true, track_hover: true});
    this.app_grid_button.icon = new St.Icon({icon_name: APP_GRID_ICON_NAME, style_class: 'system-status-icon'});
        this.app_grid_button.add_child(this.app_grid_button.icon);
    this.app_grid_button.connect('button-release-event', this._show_apps_page.bind(this));
        this.add_child(this.app_grid_button);
  }

  _show_apps_page() {
    if (Main.overview.visible) {
      Main.overview.hide();
    } else {
      Main.overview.showApps();
    }
  }

  _destroy() {
    super.destroy();
  }
});

let FavoritesMenu = GObject.registerClass(
class FavoritesMenu extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'Babar-Favorites');

    this.fav_changed = AppFavorites.getAppFavorites().connect('changed', this._display_favorites.bind(this));

      this.fav_menu_button = new St.BoxLayout({});
    this.fav_menu_icon = new St.Icon({icon_name: FAVORITES_ICON_NAME, style_class: 'system-status-icon'});
        this.fav_menu_button.add_child(this.fav_menu_icon);
        this.add_child(this.fav_menu_button);

    this._display_favorites();
  }

  _display_favorites() {
    // destroy old menu items
    if (this.menu) {
      this.menu.removeAll();
    }

    // get favorites list
      this.list_fav = AppFavorites.getAppFavorites().getFavorites();

        // create favorites items
    for (let fav_index = 0; fav_index < this.list_fav.length; ++fav_index) {
        this.fav = this.list_fav[fav_index];
        this.fav_icon = this.fav.create_icon_texture(64);

      this.item = new PopupMenu.PopupImageMenuItem(this.fav.get_name(), this.fav_icon.get_gicon());
        this.item.connect('activate', () => this._activate_fav(fav_index));
        this.menu.addMenuItem(this.item);

      // drag and drop
      this.item.fav_index = fav_index;
      this.item.is_babar_favorite = true;

      this.item._delegate = this.item;
      this.item._draggable = DND.makeDraggable(this.item, {dragActorOpacity: HIDDEN_OPACITY});

      this.item._draggable.connect('drag-end', this._on_drag_end.bind(this));
      this.item._draggable.connect('drag-cancelled', this._on_drag_end.bind(this));
      }
  }

  _on_drag_end() {
    this.menu.close();
    this._display_favorites();
  }

  _activate_fav(fav_index) {
      AppFavorites.getAppFavorites().getFavorites()[fav_index].open_new_window(-1);
    }

  _destroy() {
    if (this.fav_changed) {
      AppFavorites.getAppFavorites().disconnect(this.fav_changed);
    }
    super.destroy();
  }
});

let WorkspacesBar = GObject.registerClass(
class WorkspacesBar extends PanelMenu.Button {
  _init() {
    super._init(0.0, 'Babar-Tasks');

    // tracker for windows
    this.window_tracker = Shell.WindowTracker.get_default();

    // define gsettings schema for workspaces names, get workspaces names, signal for settings key changed
    this.ws_settings = new Gio.Settings({schema: WORKSPACES_SCHEMA});
    this.ws_names_changed = this.ws_settings.connect(`changed::${WORKSPACES_KEY}`, this._update_ws_names.bind(this));

    // define windows that need an icon (see https://www.roojs.org/seed/gir-1.2-gtk-3.0/seed/Meta.WindowType.html)
    this.window_type_whitelist = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG];

    // bar creation
    this.ws_bar = new St.BoxLayout({});
    this._update_ws_names();
    this.add_child(this.ws_bar);

    // window button tooltip
    this.window_tooltip = new WindowTooltip();

        // signals
    this._ws_number_changed = WM.connect('notify::n-workspaces', this._update_ws.bind(this));
    this._active_ws_changed = WM.connect('active-workspace-changed', this._update_ws.bind(this));
    this._windows_changed = this.window_tracker.connect('tracked-windows-changed', this._update_ws.bind(this));
    this._restacked = global.display.connect('restacked', this._update_ws.bind(this));
    //this._window_left_monitor = global.display.connect('window-left-monitor', this._update_ws.bind(this));
    //this._window_entered_monitor = global.display.connect('window-entered-monitor', this._update_ws.bind(this));
  }

  _destroy() {
    if (this.ws_settings && this.ws_names_changed) {
      this.ws_settings.disconnect(this.ws_names_changed);
    }

    if (this._ws_number_changed) {
      WM.disconnect(this._ws_number_changed);
    }

    if (this._active_ws_changed) {
      WM.disconnect(this._active_ws_changed);
    }

    if (this.window_tracker && this._windows_changed) {
      this.window_tracker.disconnect(this._windows_changed);
    }

    if (this._restacked) {
      global.display.disconnect(this._restacked);
    }

    //if (this._window_left_monitor) {
    //  global.display.disconnect(this._window_left_monitor);
    //}

    //if (this._window_entered_monitor) {
    //  global.display.disconnect(this._window_entered_monitor);
    //}

    if (this.hide_tooltip_timeout) {
      GLib.source_remove(this.hide_tooltip_timeout);
    }

    if (this.window_tooltip) {
      this.window_tooltip.destroy();
    }

    this.ws_bar.destroy();
    super.destroy();
  }

  _update_ws_names() {
    this.ws_names = this.ws_settings.get_strv(WORKSPACES_KEY);
    this._update_ws();
  }

  _update_ws() {
    // destroy old workspaces bar buttons and signals
    this.ws_bar.destroy_all_children();

    // get number of workspaces
    this.ws_count = WM.get_n_workspaces();
    this.active_ws_index = WM.get_active_workspace_index();

    // display all current workspaces and tasks buttons
    let ws_box;
    for (let ws_index = 0; ws_index < this.ws_count; ++ws_index) {
      ws_box = new WorkspaceButton();
      ws_box.number = ws_index;
      let ws_box_label = new St.Label({y_align: Clutter.ActorAlign.CENTER});

      if (ws_index == this.active_ws_index) {
        ws_box_label.style_class = 'workspace-active-squared';
      } else {
        ws_box_label.style_class = 'workspace-inactive-squared';
      }

      if (this.ws_names[ws_index]) {
        ws_box_label.set_text("  " + this.ws_names[ws_index] + "  ");
      } else {
        ws_box_label.set_text("  " + (ws_index + 1) + "  ");
      }
      ws_box.set_child(ws_box_label);

      ws_box.connect('button-release-event', (widget, event) => this._toggle_ws(widget, event, ws_index));

      this.ws_bar.add_child(ws_box);

      this.ws_current = WM.get_workspace_by_index(ws_index);
      this.ws_current.windows = this.ws_current.list_windows().sort(this._sort_windows);
      for (let window_index = 0; window_index < this.ws_current.windows.length; ++window_index) {
        this.window = this.ws_current.windows[window_index];
        if (this.window && !this.window.is_skip_taskbar() && this.window_type_whitelist.includes(this.window.get_window_type())) {
          this._create_window_button(ws_index, this.window);
        }
      }
    }
  }

  _create_window_button(ws_index, w) {
    // windows on all workspaces have to be displayed only once
    if (!w.is_on_all_workspaces() || ws_index == 0) {
      let w_box = new WindowButton();
      w_box.window = w;
      w_box.workspace_number = ws_index;
      let w_box_app = this.window_tracker.get_window_app(w);

      let w_box_icon = this._create_window_icon(w_box_app, w_box.window);
      w_box.set_child(w_box_icon);

      w_box.connect('button-release-event', (widget, event) => this._on_button_press(widget, event, w_box, ws_index, w));
      w_box.connect('notify::hover', () => this._on_button_hover(w_box, w.title));

      if (w.is_hidden()) {
        w_box.style_class = 'window-hidden';
        w_box_icon.set_opacity(HIDDEN_OPACITY);
      } else {
        if (w.has_focus()) {
          w_box.style_class = 'window-focused';
          w_box_icon.set_opacity(FOCUSED_OPACITY);
        } else {
          w_box.style_class = 'window-unfocused';
          w_box_icon.set_opacity(UNFOCUSED_OPACITY);
        }
      }

      if (w.is_on_all_workspaces()) {
        this.ws_bar.insert_child_at_index(w_box, 0);
      } else {
        this.ws_bar.add_child(w_box);
      }
    }
  }

  _create_window_icon(app, w) {
    let icon;
    if (app) {
      icon = app.create_icon_texture(ICON_SIZE);
    }
    // sometimes no icon is defined or icon is void, at least for a short time
    if (!icon || icon.get_style_class_name() == 'fallback-app-icon') {
      icon = new St.Icon({icon_name: FALLBACK_ICON_NAME, icon_size: ICON_SIZE});
      // attempt to use the window icon in place of the app's icon.
      let textureCache = St.TextureCache.get_default();
      icon.set_gicon(textureCache.bind_cairo_surface_property(w, 'icon'));
    }
    return icon;
  }

  _on_button_press(widget, event, w_box, ws_index, w) {
    // left-click: toggle window
    if (event.get_button() == 1) {
      this.window_tooltip.hide();
      if (w.has_focus() && !Main.overview.visible) {
        if (w.can_minimize()) {
          w.minimize();
        }
      } else {
        w.activate(global.get_current_time());
      }
      if (Main.overview.visible) {
        Main.overview.hide();
      }
      if (!w.is_on_all_workspaces()) {
        WM.get_workspace_by_index(ws_index).activate(global.get_current_time());
      }
    }

    // right-click: app menu
    if (RIGHT_CLICK && event.get_button() == 3) {
      // TODO
    }

    // middle-click: close window
    if (MIDDLE_CLICK && event.get_button() == 2 && w.can_close()) {
      w.delete(global.get_current_time());
      this.window_tooltip.hide();
    }
  }

  _sort_windows(w1, w2) {
    return w1.get_id() - w2.get_id();
  }

  _toggle_ws(widget, event, ws_index) {
    WM.get_workspace_by_index(ws_index).activate(global.get_current_time());
  }

  _on_button_hover(w_box, window_title) {
    if (window_title && w_box && w_box.get_hover()) {
      this.window_tooltip.set_position(w_box.get_transformed_position()[0], Main.layoutManager.primaryMonitor.y + Main.panel.height + TOOLTIP_VERTICAL_PADDING);
      this.window_tooltip.label.set_text(window_title);
      this.window_tooltip.show();
      this.hide_tooltip_timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (!Main.panel.statusArea['babar-workspaces-bar'].get_hover()) {
          this.window_tooltip.hide()
        }
      });
    } else {
      this.window_tooltip.hide();
    }
  }
});

let WindowTooltip = GObject.registerClass(
class WindowTooltip extends St.BoxLayout {
  _init() {
    super._init({style_class: 'window-tooltip'});

    this.label = new St.Label({y_align: Clutter.ActorAlign.CENTER, text: ""});
    this.add_child(this.label);
    this.hide();
    Main.layoutManager.addChrome(this);
  }
});

let WorkspaceButton = GObject.registerClass(
class WorkspaceButton extends St.Bin {
  _init() {
    super._init({visible: true, reactive: true, can_focus: true, track_hover: true});
    this._delegate = this;
  }

  acceptDrop(source) {
    // favorite menu item
    if (source.is_babar_favorite) {
      WM.get_workspace_by_index(this.number).activate(global.get_current_time());
      AppFavorites.getAppFavorites().getFavorites()[source.fav_index].open_new_window(-1);
    }

    // window button
    if (source.is_babar_task && source.workspace_number !== this.number) {
      source.window.change_workspace_by_index(this.number, false);
      if (source.window.has_focus()) {
        source.window.activate(global.get_current_time());
      }
      return true;
    }

    // dash button
    if (source instanceof Dash.DashIcon) {
      Main.overview.hide();
      WM.get_workspace_by_index(this.number).activate(global.get_current_time());
      source.app.open_new_window(-1);
      return true;
    }

    // app grid button
    if (source instanceof AppDisplay.AppIcon) {
      Main.overview.hide();
      WM.get_workspace_by_index(this.number).activate(global.get_current_time());
      source.app.open_new_window(-1);
      return true;
    }

    return false;
  }
});

let WindowButton = GObject.registerClass(
class WindowButton extends St.Bin {
  _init() {
    super._init({visible: true, reactive: true, can_focus: true, track_hover: true});

    this.is_babar_task = true;

    this._delegate = this;
    this._draggable = DND.makeDraggable(this, {dragActorOpacity: HIDDEN_OPACITY});

    this._draggable.connect('drag-end', this._cancel_drag.bind(this));
    this._draggable.connect('drag-cancelled', this._cancel_drag.bind(this));
  }

  _cancel_drag() {
    global.display.emit('restacked');
  }

  acceptDrop(source) {
    // favorite menu item
    if (source.is_babar_favorite) {
      WM.get_workspace_by_index(this.workspace_number).activate(global.get_current_time());
      AppFavorites.getAppFavorites().getFavorites()[source.fav_index].open_new_window(-1);
    }

    // window button
    if (source.is_babar_task && source.workspace_number !== this.workspace_number) {
      source.window.change_workspace_by_index(this.workspace_number, false);
      if (source.window.has_focus()) {
        source.window.activate(global.get_current_time());
      }
      return true;
    }

    // dash button
    if (source instanceof Dash.DashIcon) {
      Main.overview.hide();
      WM.get_workspace_by_index(this.workspace_number).activate(global.get_current_time());
      source.app.open_new_window(-1);
      return true;
    }

    // app grid button
    if (source instanceof AppDisplay.AppIcon) {
      Main.overview.hide();
      WM.get_workspace_by_index(this.workspace_number).activate(global.get_current_time());
      source.app.open_new_window(-1);
      return true;
    }

    return false;
  }
});

class Extension {
  constructor() {
  }

  // _show_activities(show) {
  //   this.activities_button = Main.panel.statusArea['activities'];
  //   if (this.activities_button) {
  //     if (show && !Main.sessionMode.isLocked) {
  //       this.activities_button.container.show();
  //     } else {
  //       this.activities_button.container.hide();
  //     }
  //   }
  // }

  _show_places_icon(show_icon) {
    this.places_indicator = Main.panel.statusArea['places-menu'];
    if (this.places_indicator) {
      this.places_indicator.remove_child(this.places_indicator.get_first_child());
      if (show_icon) {
        this.places_icon = new St.Icon({icon_name: PLACES_ICON_NAME, style_class: 'system-status-icon'});
        this.places_indicator.add_child(this.places_icon);
      } else {
        this.places_label = new St.Label({text: _('Places'), y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.places_indicator.add_child(this.places_label);
      }
    }
  }

  _show_dash(show) {
    if (show) {
      Main.overview.dash.show();
    } else {
      Main.overview.dash.hide();
    }
  }

  _hide_ws_thumbnails() {
    Main.overview._overview._controls._thumbnailsBox.hide();
  }

  enable() {
    // top panel left box padding
    if (REDUCE_PADDING) {
      Main.panel._leftBox.add_style_class_name('leftbox-reduced-padding');
    }

    // Activities button
    // if (!DISPLAY_ACTIVITIES) {
    //   this._show_activities(false);
    // }

    // app grid
    if (DISPLAY_APP_GRID) {
      this.app_grid = new AppGridButton();
      Main.panel.addToStatusArea('babar-app-grid-button', this.app_grid, 0, 'left');
    }

    // Places label to icon
    if (DISPLAY_PLACES_ICON) {
      this._show_places_icon(true);
      this.extensions_changed = Main.extensionManager.connect('extension-state-changed', () => this._show_places_icon(true));
    }

    // favorites
    if (DISPLAY_FAVORITES) {
      this.favorites_menu = new FavoritesMenu();
      Main.panel.addToStatusArea('babar-favorites-menu', this.favorites_menu, 3, 'left');
    }

    // tasks
    if (DISPLAY_TASKS) {
      this.workspaces_bar = new WorkspacesBar();
      Main.panel.addToStatusArea('babar-workspaces-bar', this.workspaces_bar, 5, 'left');
    }

    // AppMenu
      if (!DISPLAY_APP_MENU) {
      AppMenu.container.hide();
    }

    // dash
    // if (!DISPLAY_DASH) {
    //   this._show_dash(false);
    // }
  }

  disable() {
    // app grid
    if (DISPLAY_APP_GRID && this.app_grid) {
      this.app_grid._destroy();
    }

    // favorites
    if (DISPLAY_FAVORITES && this.favorites_menu) {
      this.favorites_menu._destroy();
    }

    // workspaces bar
    if (DISPLAY_TASKS && this.workspaces_bar) {
      this.workspaces_bar._destroy();
    }

    // top panel left box padding
    if (REDUCE_PADDING) {
      Main.panel._leftBox.remove_style_class_name('leftbox-reduced-padding');
    }

    // Places label and unwatch extensions changes
    if (DISPLAY_PLACES_ICON && this.places_indicator) {
      this._show_places_icon(false);
      Main.extensionManager.disconnect(this.extensions_changed);
    }

    // Activities button
    // this._show_activities(true);

    // AppMenu icon
    if (!Main.overview.visible && !Main.sessionMode.isLocked) {
      AppMenu.container.show();
    }

    // dash
    // this._show_dash(true);
  }
}

function init() {
  return new Extension();
}
