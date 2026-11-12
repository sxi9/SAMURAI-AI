; SAMURAI — Windows installer (Inno Setup 6).  Built by .github/workflows/build-exe.yml after PyInstaller:
;   ISCC.exe /DMyAppVersion=1.4.0 /DSourceDir=..\dist\SAMURAI installer\samurai.iss
; Per-user install (no admin): %LOCALAPPDATA%\Programs\SAMURAI. The uninstaller keeps data\ and config.json
; unless "Remove my data" is ticked. The app itself is unchanged: SAMURAI.exe starts the control panel + HUD.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\SAMURAI"
#endif
#define MyAppName "SAMURAI"
#define MyAppExe "SAMURAI.exe"
#define MyAppPublisher "SAMURAI-AI"
#define MyAppURL "https://github.com/sxi9/SAMURAI-AI"
#define IconFile "..\app\icons\samurai.ico"

[Setup]
AppId={{7D6B1F2E-5A3C-4C8E-9B0A-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/blob/main/docs/INSTALL.md
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\
OutputBaseFilename=SAMURAI-setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
CloseApplications=yes
RestartApplications=no
#if FileExists(IconFile)
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#MyAppExe}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start SAMURAI with &Windows (you can also switch this in the control panel)"; GroupDescription: "Start with boot:"; Flags: unchecked

[Files]
; everything PyInstaller produced (dist\SAMURAI\*), recursively
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; config.json, data\, logs\ and models\ are created by the app next to SAMURAI.exe on first run and are never overwritten here

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; WorkingDir: "{app}"
Name: "{group}\{#MyAppName} (app window)"; Filename: "{app}\{#MyAppExe}"; Parameters: "--window"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Parameters: "--no-browser"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "Start {#MyAppName} now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; stop a running instance before files are removed
Filename: "taskkill"; Parameters: "/IM {#MyAppExe} /F"; Flags: runhidden; RunOnceId: "killsamurai"

[Code]
var
  RemoveData: Boolean;

// Ask once on uninstall whether personal data goes too.
function InitializeUninstall(): Boolean;
begin
  Result := True;
  RemoveData := MsgBox('Remove my data too?' + #13#10 + #13#10 +
    'Yes: delete config.json, data\ (memory, journal, widgets), logs\ and the downloaded models.' + #13#10 +
    'No: keep them so a later install picks them up again.', mbConfirmation, MB_YESNO) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    AppDir := ExpandConstant('{app}');
    if RemoveData then
    begin
      DelTree(AppDir + '\data', True, True, True);
      DelTree(AppDir + '\logs', True, True, True);
      DelTree(AppDir + '\models', True, True, True);
      DeleteFile(AppDir + '\config.json');
      RemoveDir(AppDir);
    end;
  end;
end;
