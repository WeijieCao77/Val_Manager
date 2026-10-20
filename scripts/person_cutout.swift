// Cut one person out of a photo: the person whose body holds the given point
// (the centre of his face), everything else transparent. macOS Vision's person
// instance mask (up to four people, kept apart), falling back to the
// foreground instance mask; no model to download.
//
//   swift scripts/person_cutout.swift in.jpg out.png <x> <y> [in2.jpg out2.png x y ...]
//
// x, y in pixels, origin top-left. When the frame holds other people, their mask is written beside the
// cutout as <out>-others.png (white = someone else). One JSON line per image:
// {"in", "out", "how": "person"|"foreground"|"none", "instances": n}
import AppKit
import CoreImage
import Foundation
import Vision

let args = Array(CommandLine.arguments.dropFirst())
let ctx = CIContext()

func emit(_ d: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: d), let s = String(data: data, encoding: .utf8) { print(s) }
}

func pick(_ obs: VNInstanceMaskObservation, _ handler: VNImageRequestHandler, _ px: CGPoint, _ size: CGSize) -> (CVPixelBuffer, Int, CVPixelBuffer?)? {
    // which instance sits under the face: read the low-res instance label map
    let labels = obs.instanceMask
    CVPixelBufferLockBaseAddress(labels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(labels, .readOnly) }
    let lw = CVPixelBufferGetWidth(labels), lh = CVPixelBufferGetHeight(labels)
    let row = CVPixelBufferGetBytesPerRow(labels)
    guard let base = CVPixelBufferGetBaseAddress(labels)?.assumingMemoryBound(to: UInt8.self) else { return nil }
    let cx = min(lw - 1, max(0, Int(px.x / size.width * CGFloat(lw))))
    let cy = min(lh - 1, max(0, Int(px.y / size.height * CGFloat(lh))))
    // the face point itself, or the commonest label in a small window around it
    var counts: [Int: Int] = [:]
    for dy in -3...3 { for dx in -3...3 {
        let x = min(lw - 1, max(0, cx + dx)), y = min(lh - 1, max(0, cy + dy))
        let v = Int(base[y * row + x]); if v > 0 { counts[v, default: 0] += 1 }
    } }
    guard let label = counts.max(by: { $0.value < $1.value })?.key else { return nil }
    guard let mask = try? obs.generateScaledMaskForImage(forInstances: IndexSet(integer: label), from: handler) else { return nil }
    // everyone else in the frame, so a softened background can leave the teammate out
    var others = obs.allInstances
    others.remove(label)
    let rest = others.isEmpty ? nil : try? obs.generateScaledMaskForImage(forInstances: others, from: handler)
    return (mask, obs.allInstances.count, rest)
}

var i = 0
while i + 3 < args.count {
    let inPath = args[i], outPath = args[i + 1]
    let pt = CGPoint(x: Double(args[i + 2]) ?? 0, y: Double(args[i + 3]) ?? 0)
    i += 4
    guard let ns = NSImage(contentsOfFile: inPath), let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        emit(["in": inPath, "error": "unreadable"]); continue
    }
    let size = CGSize(width: cg.width, height: cg.height)
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    var how = "none", n = 0
    var mask: CVPixelBuffer?
    var rest: CVPixelBuffer?
    let person = VNGeneratePersonInstanceMaskRequest()
    if (try? handler.perform([person])) != nil, let obs = person.results?.first, let got = pick(obs, handler, pt, size) {
        mask = got.0; n = got.1; rest = got.2; how = "person"
    } else {
        let fg = VNGenerateForegroundInstanceMaskRequest()
        if (try? handler.perform([fg])) != nil, let obs = fg.results?.first, let got = pick(obs, handler, pt, size) {
            mask = got.0; n = got.1; rest = got.2; how = "foreground"
        }
    }
    guard let m = mask else { emit(["in": inPath, "out": outPath, "how": how, "instances": n]); continue }
    let image = CIImage(cgImage: cg)
    var alpha = CIImage(cvPixelBuffer: m)
    alpha = alpha.transformed(by: CGAffineTransform(scaleX: size.width / alpha.extent.width, y: size.height / alpha.extent.height))
    let clear = CIImage(color: .clear).cropped(to: image.extent)
    let blend = CIFilter(name: "CIBlendWithMask", parameters: [kCIInputImageKey: image, kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: alpha])!
    guard let out = blend.outputImage, let space = CGColorSpace(name: CGColorSpace.sRGB) else { continue }
    do {
        try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: outPath), format: .RGBA8, colorSpace: space)
        // the others' mask beside it (<out>-others.png, white = another person), or nothing when he was alone
        let othersPath = outPath.replacingOccurrences(of: ".png", with: "-others.png")
        try? FileManager.default.removeItem(atPath: othersPath)
        if let r = rest {
            var o = CIImage(cvPixelBuffer: r)
            o = o.transformed(by: CGAffineTransform(scaleX: size.width / o.extent.width, y: size.height / o.extent.height))
            try ctx.writePNGRepresentation(of: o, to: URL(fileURLWithPath: othersPath), format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
        }
        emit(["in": inPath, "out": outPath, "how": how, "instances": n])
    } catch { emit(["in": inPath, "out": outPath, "error": "\(error)"]) }
}
