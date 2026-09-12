// Face rectangles for a batch of photos, so a crop can be centred on the face
// rather than on the middle of the frame. macOS Vision; no model to download.
//
//   swift scripts/face_boxes.swift a.jpg b.png ...
//
// One JSON line per image: {"path", "width", "height", "faces": [{x, y, w, h}]},
// pixels, origin top-left, largest face first.
import AppKit
import Foundation
import Vision

for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print(#"{"path":"\#(path)","error":"unreadable"}"#)
        continue
    }
    let w = Double(cg.width), h = Double(cg.height)
    let request = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    let faces = (request.results ?? [])
        .map { $0.boundingBox }
        .sorted { $0.width * $0.height > $1.width * $1.height }
        .map { b in ["x": b.minX * w, "y": (1 - b.maxY) * h, "w": b.width * w, "h": b.height * h] }
    let line: [String: Any] = ["path": path, "width": w, "height": h, "faces": faces]
    if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}
