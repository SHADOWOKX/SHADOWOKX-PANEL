#define AppName "Shadowokx Panel"
#define AppVersion "1.0.0"
#ifndef SourceDir
  #define SourceDir "..\artifacts\win-x64"
#endif

[Setup]
AppId={{A0455356-7B91-4FF3-9314-0193FE9CC9E2}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Shadowokx
DefaultDirName={localappdata}\Programs\Shadowokx Panel
DefaultGroupName=Shadowokx Panel
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\artifacts
OutputBaseFilename=ShadowokxPanel-{#AppVersion}-win-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#AppName}

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Shadowokx Panel"; Filename: "{app}\ShadowokxPanel.exe"
Name: "{userdesktop}\Shadowokx Panel"; Filename: "{app}\ShadowokxPanel.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Run]
Filename: "{app}\ShadowokxPanel.exe"; Description: "Launch Shadowokx Panel"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/d /c reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v ShadowokxPanel /f"; Flags: runhidden; RunOnceId: "RemoveStartup"
