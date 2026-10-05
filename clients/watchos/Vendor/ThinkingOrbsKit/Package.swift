// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ThinkingOrbsKit",
    platforms: [.iOS(.v15), .macOS(.v12), .watchOS(.v10)],
    products: [
        .library(name: "ThinkingOrbsKit", targets: ["ThinkingOrbsKit"])
    ],
    targets: [
        .target(name: "ThinkingOrbsKit"),
        .testTarget(
            name: "ThinkingOrbsKitTests",
            dependencies: ["ThinkingOrbsKit"]
        )
    ]
)
