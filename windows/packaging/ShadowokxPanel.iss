#define AppName "Shadowokx Panel"
#define AppPublisher "Shadowokx"
#ifndef SourceDir
  #define SourceDir "..\artifacts\win-x64"
#endif
#ifndef AppVersion
  #define AppVersion GetFileVersion(SourceDir + "\ShadowokxPanel.exe")
#endif
#ifndef OutputDir
  #define OutputDir "..\artifacts\release"
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "ShadowokxPanel-Setup-x64"
#endif

[Setup]
AppId={{A0455356-7B91-4FF3-9314-0193FE9CC9E2}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/SHADOWOKX/SHADOWOKX-PANEL
AppSupportURL=https://github.com/SHADOWOKX/SHADOWOKX-PANEL/issues
AppUpdatesURL=https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} installer
VersionInfoProductName={#AppName}
DefaultDirName={localappdata}\Programs\Shadowokx Panel
DefaultGroupName=Shadowokx Panel
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=ShadowokxPanel.exe
RestartApplications=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\ShadowokxPanel.exe
SetupIconFile=..\src\ShadowokxPanel\Assets\ShadowokxPanel.ico
UsePreviousAppDir=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Shadowokx Panel"; Filename: "{app}\ShadowokxPanel.exe"
Name: "{userdesktop}\Shadowokx Panel"; Filename: "{app}\ShadowokxPanel.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Run]
Filename: "{app}\ShadowokxPanel.exe"; Description: "Launch Shadowokx Panel"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RegDeleteValue(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\Run', 'ShadowokxPanel');
end;
