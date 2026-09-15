#!/usr/bin/env python3
"""Generate the dependency-free Xcode project. No XcodeGen installation needed."""
import hashlib
import plistlib
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'ios'
project = root / 'WaySignal.xcodeproj'
project.mkdir(parents=True, exist_ok=True)
def ident(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
objects = []
def add(name, value):
    key = ident(name)
    objects.append(f'\t\t{key} = {{ {value} }};')
    return key
def refs(names): return '(' + ', '.join(ident(n) for n in names) + ',)'

sources = sorted((root / 'WaySignal').glob('*.swift'))
for file in sources:
    add('ref:' + file.name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {file.name}; sourceTree = "<group>";')
    add('build:' + file.name, f'isa = PBXBuildFile; fileRef = {ident("ref:" + file.name)};')
add('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = WaySignal.app; sourceTree = BUILT_PRODUCTS_DIR;')
add('source-group', f'isa = PBXGroup; children = {refs(["ref:" + f.name for f in sources])}; path = WaySignal; sourceTree = "<group>";')
add('products', f'isa = PBXGroup; children = {refs(["product"])}; name = Products; sourceTree = "<group>";')
add('main-group', f'isa = PBXGroup; children = {refs(["source-group", "products"])}; sourceTree = "<group>";')
add('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {refs(["build:" + f.name for f in sources])}; runOnlyForDeploymentPostprocessing = 0;')
add('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
add('resources', 'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
for config in ['Debug', 'Release']:
    project_settings = 'SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0;'
    if config == 'Debug': project_settings += ' SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; DEBUG_INFORMATION_FORMAT = dwarf;'
    else: project_settings += ' SWIFT_OPTIMIZATION_LEVEL = "-O"; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; VALIDATE_PRODUCT = YES;'
    add('project-' + config, f'isa = XCBuildConfiguration; buildSettings = {{ {project_settings} }}; name = {config};')
    target_settings = f'PRODUCT_BUNDLE_IDENTIFIER = org.waysignal.ios; PRODUCT_NAME = "$(TARGET_NAME)"; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ""; TARGETED_DEVICE_FAMILY = 1; INFOPLIST_FILE = "WaySignal/Info-{config}.plist"; GENERATE_INFOPLIST_FILE = NO; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 0.1.0; SWIFT_EMIT_LOC_STRINGS = YES; ENABLE_PREVIEWS = YES; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";'
    add('target-' + config, f'isa = XCBuildConfiguration; buildSettings = {{ {target_settings} }}; name = {config};')
    plist = {
        'CFBundleDevelopmentRegion': 'en', 'CFBundleDisplayName': 'WaySignal',
        'CFBundleExecutable': '$(EXECUTABLE_NAME)', 'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)',
        'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': '$(PRODUCT_NAME)',
        'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '$(MARKETING_VERSION)',
        'CFBundleVersion': '$(CURRENT_PROJECT_VERSION)', 'LSRequiresIPhoneOS': True,
        'UILaunchScreen': {}, 'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False},
        'UISupportedInterfaceOrientations': ['UIInterfaceOrientationPortrait'],
        'NSLocationWhenInUseUsageDescription': 'Use your location as a starting point. You can enter coordinates instead.',
    }
    if config == 'Debug':
        plist['NSAppTransportSecurity'] = {'NSAllowsArbitraryLoads': True}
        plist['NSLocalNetworkUsageDescription'] = 'Connect to your local WaySignal development server.'
    (root / 'WaySignal' / f'Info-{config}.plist').write_bytes(plistlib.dumps(plist))

for kind in ['project', 'target']:
    add(kind + '-configs', f'isa = XCConfigurationList; buildConfigurations = {refs([kind + "-Debug", kind + "-Release"])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
add('target', f'isa = PBXNativeTarget; buildConfigurationList = {ident("target-configs")}; buildPhases = {refs(["sources", "frameworks", "resources"])}; buildRules = (); dependencies = (); name = WaySignal; productName = WaySignal; productReference = {ident("product")}; productType = "com.apple.product-type.application";')
add('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; }}; buildConfigurationList = {ident("project-configs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base,); mainGroup = {ident("main-group")}; productRefGroup = {ident("products")}; projectDirPath = ""; projectRoot = ""; targets = {refs(["target"])};')
(project / 'project.pbxproj').write_text('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n' + '\n'.join(objects) + f'\n\t}};\n\trootObject = {ident("project")};\n}}\n')
schemes = project / 'xcshareddata' / 'xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ident("target")}" BuildableName="WaySignal.app" BlueprintName="WaySignal" ReferencedContainer="container:WaySignal.xcodeproj"/>'
(schemes / 'WaySignal.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print(f'Generated {project} with {len(sources)} Swift files.')
