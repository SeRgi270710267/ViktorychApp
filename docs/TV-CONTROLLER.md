# Playing ReGone with a controller (ViktorychTV app 1.2.0)

ReGone (by NZlay) is a Unity WebGL game. It reads the keyboard, the mouse and its own on-screen touch
controls (`ReGoneMobile.js`), but not gamepads, and its `framework.js` ignores input that a page script
makes up (untrusted events). So the controller support lives in the Android TV app: the app opens the game
in its own WebView and turns controller input into real key presses and touches on that WebView. Android
delivers those as trusted input, so the game sees them like a keyboard and a finger.

## How to open it

- In the TV app (1.2.0, versionCode 3 or newer): Games > **Play with controller**, or the
  "Controller connected." note on the ReGone screen.
- The link is `viktorychtv://game/regone` (the site uses
  `intent://game/regone#Intent;scheme=viktorychtv;package=app.viktorych.tv;end`).
- The site only shows the button when `ViktorychTVMode.inApp()` and `appVersion() >= 3`. Older apps
  and browsers only get the note "Play with a controller in the ViktorychTV app."

`GameActivity` is always a WebView, even when Chrome is installed (the Chrome TWA cannot receive
injected input). It loads `https://nzlay.com/ReGone/game/index.html` at the top level, full screen, in
landscape, with the screen kept on. Video full screen works through `onShowCustomView`. Links away from
nzlay.com open outside the game.

## Default layout

| Controller | In the game |
| --- | --- |
| Left stick | Move (W A S D) |
| Left stick press (L3) | Sprint (Shift) |
| Right stick | Look (a finger dragged on the game's look area) |
| Right stick press (R3) | Melee (1) |
| RT | Fire (the game's fire button) |
| LT | Aim (the game's aim button) |
| A | Jump (Space) |
| B | Crouch (C) |
| X | Reload (R) |
| Y | Use (E) |
| LB / RB | Previous / next weapon (keys 1 to 4) |
| D-pad up / down / left / right | Binoculars (Z) / Prone (X) / Buy (B) / Inspect (G) |
| Start (Menu, Options) | Our menu: resume, game menu, mode, controls, look sensitivity, invert, move with, button icons, show controls, exit |
| View (Back, Share, Select) | Scoreboard (Tab) |
| Start + View | Switch between play and cursor mode by hand |

Every button except Start can be moved in Menu > Controls, with **Reset**. Layout, look sensitivity (1 to
10), invert look, "move with" (keys or the on-screen joystick) and the icon style are saved per controller.

## Modes

The page hook wraps `ReGoneTouch.mode()` and tells the app the game's mode, so the app switches by itself:

- **Menus (mode 0): cursor mode.** The right stick (or left stick) moves a drawn cursor; A or RT taps,
  B is Escape, the D-pad sends arrow keys, View is Tab.
- **In a match (mode 2): play mode**, the layout above.
- **Spectating (mode 3):** RT next player, LT previous player, A switches the view.

If the game does not report a mode (for example a new game version), the app starts in cursor mode and
Start + View switches by hand.

## Look and buttons

- Sticks use a radial dead zone (0.15), a squared speed curve and the sensitivity setting.
- Look drags one finger on the game's look area (from 55% across, 35% down). The finger lifts and starts
  again before it leaves the area, and lifts after 120 ms without movement.
- Fire, aim, the game menu and the spectator buttons are tapped at the positions the page reports
  (`#rg-actions`, `#rg-top`, `#rg-watch`). If the page cannot report them, the app uses positions worked
  out from the `ReGoneMobile.js` layout.
- Icons: Xbox letters (A B X Y, LB RB, LT RT) by default; PlayStation shapes when the controller is
  Sony (vendor 0x054C) or its name says PlayStation, DualSense, DualShock or "Wireless Controller".
  Menu > Button icons overrides it.

## Code

- `android-tv/app/src/main/java/app/viktorych/tv/GameActivity.java`: the WebView, the page hook, input
  capture, the frame loop, the hint strip and our menu.
- `android-tv/app/src/main/java/app/viktorych/tv/pad/`: `PadMath` (dead zone, curve, look),
  `PadButton`, `PadAction`, `PadLayout` (remap), `PadModes`, `PadMapper` (buttons to keys and touches),
  `TouchInjector`, `PadPrefs`, `Glyphs`, `HintView`.
- Tests: `cd android-tv && gradle testDebugUnitTest` (JVM tests in `app/src/test`), and
  `node scripts/tv_controller_link_test.mjs` (needs Playwright) for the site button and note.

## Honest limits

- Not tested on a real TV yet. The Android emulator does not run on the build box (no KVM).
- Whether ReGone reads keyboard keys while its touch controls are on must be checked on a device. If
  movement keys do nothing, set Menu > Move with > On-screen joystick. Jump, crouch and reload are keys
  only, so if keys are ignored entirely, only move, look, fire, aim and the menu work.
- Mouse look (pointer lock) is not used; look is always the touch drag.
- Weapon cycling counts slots 1 to 4 itself; it cannot read which weapon the game has selected, so after
  picking a weapon by touch the first LB/RB press can skip one.
- Stick and trigger axes differ between controllers. The right stick reads Z/RZ, or RX/RY when the
  controller has no RZ. Triggers read the trigger axes or the buttons, whichever moves.
- If NZlay changes the page layout, the fallback positions may miss until the hook is updated.

## Device test checklist

1. Install 1.2.0 over 1.1.0 (it must update in place, same key).
2. Pair an Xbox controller, then a PlayStation one. Check the icons switch.
3. Games > Play with controller opens the game full screen in landscape; the screen stays on.
4. Main menu: the cursor appears; A taps; B backs out.
5. Join a match: play mode starts by itself. Check move, sprint, look (and invert), fire, aim, jump,
   crouch, reload, use, weapons, D-pad actions, Tab scoreboard.
6. If movement does nothing, switch Move with to On-screen joystick and test again.
7. Die and spectate: RT/LT switch players, A switches view.
8. Start: menu opens; remap A to Reload and back; reset; exit; reopen and check the setting stayed.
9. Remote Back opens the menu; Back again resumes.
10. Unplug the controller mid-match: nothing stays pressed.
