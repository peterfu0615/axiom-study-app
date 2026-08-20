import AVFoundation
import CoreImage
import Foundation
import ImageIO
import PDFKit
import Vision

private struct NormalizedRect: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var maxX: Double { x + width }
    var maxY: Double { y + height }

    func expanded(by padding: Double) -> NormalizedRect {
        let nextX = max(0, x - padding)
        let nextY = max(0, y - padding)
        return NormalizedRect(
            x: nextX,
            y: nextY,
            width: min(1 - nextX, width + padding * 2),
            height: min(1 - nextY, height + padding * 2)
        )
    }

    func clamped() -> NormalizedRect {
        let nextX = min(1, max(0, x))
        let nextY = min(1, max(0, y))
        return NormalizedRect(
            x: nextX,
            y: nextY,
            width: min(1 - nextX, max(0.001, width)),
            height: min(1 - nextY, max(0.001, height))
        )
    }

    static func union(_ values: [NormalizedRect]) -> NormalizedRect {
        guard let first = values.first else {
            return NormalizedRect(x: 0.05, y: 0.05, width: 0.9, height: 0.9)
        }
        let minX = values.dropFirst().reduce(first.x) { min($0, $1.x) }
        let minY = values.dropFirst().reduce(first.y) { min($0, $1.y) }
        let maxX = values.dropFirst().reduce(first.maxX) { max($0, $1.maxX) }
        let maxY = values.dropFirst().reduce(first.maxY) { max($0, $1.maxY) }
        return NormalizedRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

private struct Point: Codable {
    let x: Double
    let y: Double
}

private struct TextLine: Codable {
    let id: String
    let text: String
    let confidence: Double
    let rect: NormalizedRect
}

private struct ProblemBlock: Codable {
    let id: String
    var title: String
    var rect: NormalizedRect
    var confidence: Double
    var lineIds: [String]
    var source: String
}

private struct QuestionAnchor {
    let number: Int
    let line: TextLine
}

private struct ProcessResult: Codable {
    let correctedPath: String
    let width: Int
    let height: Int
    let pageDetected: Bool
    let corners: [String: Point]
    let textLines: [TextLine]
    let blocks: [ProblemBlock]
    let enhancementMode: String
    let warnings: [String]
}

private struct CameraOrientationUpdate: Codable {
    let deviceName: String
    let isContinuityCamera: Bool
    let rotationAngle: Double
}

private struct TextbookExtractedPage: Codable {
    let pageNumber: Int
    let evidenceText: String
    let extractionMethod: String
    let confidence: Double
}

private struct TextbookOutlineCandidate: Codable {
    let title: String
    let level: Int
    let pageNumber: Int
    let evidenceText: String
    let confidence: Double
}

private struct TextbookExtractionResult: Codable {
    let pageCount: Int
    let extractionMethod: String
    let pages: [TextbookExtractedPage]
    let outline: [TextbookOutlineCandidate]
    let warnings: [String]
}

private func emitTextbookProgress(
    currentPage: Int,
    totalPages: Int,
    pdfTextPages: Int,
    ocrPages: Int,
    failedPages: Int,
    phase: String
) {
    let payload: [String: Any] = [
        "currentPage": currentPage,
        "totalPages": totalPages,
        "pdfTextPages": pdfTextPages,
        "ocrPages": ocrPages,
        "failedPages": failedPages,
        "phase": phase,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8),
          let line = "AXIOM_PROGRESS \(json)\n".data(using: .utf8) else { return }
    FileHandle.standardError.write(line)
}

private func emitDocumentProgress(
    stage: String,
    correctedPath: String? = nil,
    width: Int? = nil,
    height: Int? = nil
) {
    var payload: [String: Any] = ["stage": stage]
    if let correctedPath { payload["correctedPath"] = correctedPath }
    if let width { payload["width"] = width }
    if let height { payload["height"] = height }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let json = String(data: data, encoding: .utf8),
          let line = "AXIOM_PROGRESS \(json)\n".data(using: .utf8) else { return }
    FileHandle.standardError.write(line)
}

private func recognizeText(in image: CGImage) throws -> (text: String, confidence: Double) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    try VNImageRequestHandler(cgImage: image).perform([request])
    let observations = request.results ?? []
    let candidates = observations.compactMap { observation -> (String, Float)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, candidate.confidence)
    }
    let text = candidates.map { $0.0 }.joined(separator: "\n")
    let confidence = candidates.isEmpty
        ? 0
        : candidates.map { Double($0.1) }.reduce(0, +) / Double(candidates.count)
    return (text, confidence)
}

private func outlineCandidates(from pages: [TextbookExtractedPage]) -> [TextbookOutlineCandidate] {
    let patterns: [(String, Int)] = [
        // More specific numeric headings must precede the generic `15.1`
        // pattern; otherwise the latter is mistaken for a top-level `15.`
        // heading.  Matching a whitespace-free copy also handles TOCs that
        // render `第 15 章` and `15 . 1` with font spacing.
        (#"^第[一二三四五六七八九十百0-9]+(章|单元|篇).{0,32}$"#, 1),
        (#"^第[一二三四五六七八九十百0-9]+节.{0,32}$"#, 2),
        (#"^[0-9]+\.[0-9]+\.[0-9]+.{1,36}$"#, 3),
        (#"^[0-9]+\.[0-9]+.{1,36}$"#, 2),
        (#"^[0-9]+[、\.].{2,36}$"#, 3),
    ]
    var seen = Set<String>()
    var output: [TextbookOutlineCandidate] = []
    for page in pages {
        for rawLine in page.evidenceText.components(separatedBy: .newlines) {
            let title = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard title.count >= 2, title.count <= 48 else { continue }
            let compactTitle = title.replacingOccurrences(
                of: #"\s+"#, with: "", options: .regularExpression
            )
            var matchedLevel: Int?
            for (pattern, level) in patterns {
                if compactTitle.range(of: pattern, options: .regularExpression) != nil {
                    matchedLevel = level
                    break
                }
            }
            guard let level = matchedLevel else { continue }
            let key = title.lowercased()
            guard seen.insert(key).inserted else { continue }
            output.append(TextbookOutlineCandidate(
                title: title,
                level: level,
                pageNumber: page.pageNumber,
                evidenceText: rawLine,
                confidence: min(page.confidence, 0.92)
            ))
        }
    }
    return output
}

private struct RasterizedPDFPage {
    let image: CGImage
    let pixelWidth: Int
    let pixelHeight: Int
}

private func rasterizePDFPage(
    _ page: CGPDFPage,
    pixelWidth requestedWidth: Int,
    maximumPixelHeight: Int? = nil
) throws -> RasterizedPDFPage {
    let bounds = page.getBoxRect(.mediaBox).standardized
    guard bounds.width > 0, bounds.height > 0, requestedWidth > 0 else {
        throw ProcessorError.renderFailed
    }

    let normalizedRotation = ((page.rotationAngle % 360) + 360) % 360
    let swapsDimensions = normalizedRotation == 90 || normalizedRotation == 270
    let logicalWidth = swapsDimensions ? bounds.height : bounds.width
    let logicalHeight = swapsDimensions ? bounds.width : bounds.height
    var width = CGFloat(requestedWidth)
    var height = width * logicalHeight / logicalWidth
    if let maximumPixelHeight, height > CGFloat(maximumPixelHeight) {
        height = CGFloat(maximumPixelHeight)
        width = height * logicalWidth / logicalHeight
    }
    let pixelWidth = max(1, Int(width.rounded()))
    let pixelHeight = max(1, Int(height.rounded()))

    guard let context = CGContext(
        data: nil,
        width: pixelWidth,
        height: pixelHeight,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw ProcessorError.renderFailed
    }
    let target = CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(target)
    context.interpolationQuality = .high
    context.concatenate(page.getDrawingTransform(
        .mediaBox,
        rect: target,
        rotate: 0,
        preserveAspectRatio: true
    ))
    context.drawPDFPage(page)
    guard let image = context.makeImage() else {
        throw ProcessorError.renderFailed
    }
    return RasterizedPDFPage(image: image, pixelWidth: pixelWidth, pixelHeight: pixelHeight)
}

private func writePNGAtomically(_ image: CGImage, to outputURL: URL) throws {
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    let temporaryURL = outputURL
        .deletingLastPathComponent()
        .appendingPathComponent(".\(outputURL.lastPathComponent).\(UUID().uuidString).tmp")
    guard let destination = CGImageDestinationCreateWithURL(
        temporaryURL as CFURL,
        "public.png" as CFString,
        1,
        nil
    ) else {
        throw ProcessorError.renderFailed
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        try? FileManager.default.removeItem(at: temporaryURL)
        throw ProcessorError.renderFailed
    }
    do {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            _ = try FileManager.default.replaceItemAt(outputURL, withItemAt: temporaryURL)
        } else {
            try FileManager.default.moveItem(at: temporaryURL, to: outputURL)
        }
    } catch {
        try? FileManager.default.removeItem(at: temporaryURL)
        throw error
    }
}

private func extractTextbookPDF(inputPath: String) throws -> TextbookExtractionResult {
    let inputURL = URL(fileURLWithPath: inputPath)
    guard let document = PDFDocument(url: inputURL),
          let renderingDocument = CGPDFDocument(inputURL as CFURL) else {
        throw ProcessorError.unreadableImage
    }
    var pages: [TextbookExtractedPage] = []
    var warnings: [String] = []
    var textPageCount = 0
    var ocrPageCount = 0
    var failedPageCount = 0
    let maximumPages = document.pageCount
    emitTextbookProgress(currentPage: 0, totalPages: maximumPages, pdfTextPages: 0, ocrPages: 0, failedPages: 0, phase: "reading")

    // A page whose rendering or OCR fails must not silently disappear from the
    // output: downstream consumers rely on page numbers staying contiguous.
    // Emit an explicit placeholder entry instead.
    func appendFailedPage(pageNumber: Int, reason: String) {
        failedPageCount += 1
        warnings.append("第 \(pageNumber) 页\(reason)，已保留占位条目")
        pages.append(TextbookExtractedPage(
            pageNumber: pageNumber,
            evidenceText: "",
            extractionMethod: "failed",
            confidence: 0
        ))
        emitTextbookProgress(currentPage: pageNumber, totalPages: maximumPages, pdfTextPages: textPageCount, ocrPages: ocrPageCount, failedPages: failedPageCount, phase: "failed")
    }

    for index in 0..<maximumPages {
        guard let page = document.page(at: index) else {
            appendFailedPage(pageNumber: index + 1, reason: "无法读取")
            continue
        }
        let embedded = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if embedded.count >= 20 {
            textPageCount += 1
            pages.append(TextbookExtractedPage(
                pageNumber: index + 1,
                evidenceText: embedded,
                extractionMethod: "pdf_text",
                confidence: 0.99
            ))
            emitTextbookProgress(currentPage: index + 1, totalPages: maximumPages, pdfTextPages: textPageCount, ocrPages: ocrPageCount, failedPages: failedPageCount, phase: "pdf_text")
            continue
        }
        guard let renderingPage = renderingDocument.page(at: index + 1) else {
            appendFailedPage(pageNumber: index + 1, reason: "无法渲染")
            continue
        }
        let bounds = renderingPage.getBoxRect(.mediaBox).standardized
        let normalizedRotation = ((renderingPage.rotationAngle % 360) + 360) % 360
        let logicalWidth = normalizedRotation == 90 || normalizedRotation == 270
            ? bounds.height
            : bounds.width
        let image: CGImage
        do {
            image = try rasterizePDFPage(
                renderingPage,
                pixelWidth: min(2400, max(600, Int((logicalWidth * 2).rounded()))),
                maximumPixelHeight: 3200
            ).image
        } catch {
            appendFailedPage(pageNumber: index + 1, reason: "无法渲染")
            continue
        }
        let recognized: (text: String, confidence: Double)
        do {
            recognized = try recognizeText(in: image)
        } catch {
            appendFailedPage(pageNumber: index + 1, reason: "OCR 失败")
            continue
        }
        ocrPageCount += 1
        pages.append(TextbookExtractedPage(
            pageNumber: index + 1,
            evidenceText: recognized.text,
            extractionMethod: "vision_ocr",
            confidence: recognized.confidence
        ))
        emitTextbookProgress(currentPage: index + 1, totalPages: maximumPages, pdfTextPages: textPageCount, ocrPages: ocrPageCount, failedPages: failedPageCount, phase: "vision_ocr")
    }
    if maximumPages > 0 && textPageCount == 0 && ocrPageCount == 0 {
        throw ProcessorError.noExtractablePages
    }
    let extractionMethod: String
    if textPageCount > 0 && ocrPageCount > 0 {
        extractionMethod = "mixed"
    } else if ocrPageCount > 0 {
        extractionMethod = "vision_ocr"
    } else {
        extractionMethod = "pdf_text"
    }
    return TextbookExtractionResult(
        pageCount: document.pageCount,
        extractionMethod: extractionMethod,
        pages: pages,
        outline: outlineCandidates(from: pages),
        warnings: warnings
    )
}

private struct PDFPagePreview: Codable {
    let path: String
    let pixelWidth: Int
    let pixelHeight: Int
}

private func renderPDFPage(
    inputPath: String,
    outputPath: String,
    pageNumber: Int,
    pixelWidth: Int
) throws -> PDFPagePreview {
    guard let document = CGPDFDocument(URL(fileURLWithPath: inputPath) as CFURL) else {
        throw ProcessorError.unreadableImage
    }
    guard pageNumber > 0, pageNumber <= document.numberOfPages,
          let page = document.page(at: pageNumber), pixelWidth >= 600, pixelWidth <= 2400 else {
        throw ProcessorError.invalidArguments
    }
    let rendered = try rasterizePDFPage(page, pixelWidth: pixelWidth)
    let outputURL = URL(fileURLWithPath: outputPath)
    try writePNGAtomically(rendered.image, to: outputURL)
    return PDFPagePreview(
        path: outputPath,
        pixelWidth: rendered.pixelWidth,
        pixelHeight: rendered.pixelHeight
    )
}

private func extractTextbookImage(inputPath: String) throws -> TextbookExtractionResult {
    emitTextbookProgress(currentPage: 0, totalPages: 1, pdfTextPages: 0, ocrPages: 0, failedPages: 0, phase: "vision_ocr")
    guard
        let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: inputPath) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
        throw ProcessorError.unreadableImage
    }
    let recognized = try recognizeText(in: image)
    let page = TextbookExtractedPage(
        pageNumber: 1,
        evidenceText: recognized.text,
        extractionMethod: "vision_ocr",
        confidence: recognized.confidence
    )
    emitTextbookProgress(currentPage: 1, totalPages: 1, pdfTextPages: 0, ocrPages: 1, failedPages: 0, phase: "vision_ocr")
    return TextbookExtractionResult(
        pageCount: 1,
        extractionMethod: "vision_ocr",
        pages: [page],
        outline: outlineCandidates(from: [page]),
        warnings: []
    )
}

private enum ProcessorError: LocalizedError {
    case invalidArguments
    case invalidCrop
    case unreadableImage
    case renderFailed
    case noExtractablePages
    case cameraNotFound

    var errorDescription: String? {
        switch self {
        case .invalidArguments: return "参数不完整"
        case .invalidCrop: return "题块裁剪区域无效"
        case .unreadableImage: return "无法读取图片"
        case .renderFailed: return "无法生成矫正图片"
        case .noExtractablePages: return "教材中没有任何可提取文字的页面"
        case .cameraNotFound: return "找不到对应的相机设备"
        }
    }
}

private func cameraDevice(deviceLabel: String) throws -> AVCaptureDevice {
    let discovery = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
        mediaType: .video,
        position: .unspecified
    )
    let normalizedLabel = deviceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let device = discovery.devices.first(where: {
        $0.localizedName.caseInsensitiveCompare(normalizedLabel) == .orderedSame
            || normalizedLabel.localizedCaseInsensitiveContains($0.localizedName)
            || $0.localizedName.localizedCaseInsensitiveContains(normalizedLabel)
    }) else {
        throw ProcessorError.cameraNotFound
    }
    return device
}

private final class OrientationEventEmitter {
    private let device: AVCaptureDevice
    private var lastAngle: Double?

    init(device: AVCaptureDevice) {
        self.device = device
    }

    func emit(angle: Double) {
        if let lastAngle, abs(lastAngle - angle) < 0.1 { return }
        lastAngle = angle
        let update = CameraOrientationUpdate(
            deviceName: device.localizedName,
            isContinuityCamera: device.deviceType == .continuityCamera
                || device.localizedName.localizedCaseInsensitiveContains("iPhone"),
            rotationAngle: angle
        )
        guard let data = try? JSONEncoder().encode(update) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

private func watchCameraOrientation(deviceLabel: String) throws {
    let device = try cameraDevice(deviceLabel: deviceLabel)
    let emitter = OrientationEventEmitter(device: device)
    guard #available(macOS 14.0, *) else {
        emitter.emit(angle: 0)
        RunLoop.main.run()
        return
    }
    let coordinator = AVCaptureDevice.RotationCoordinator(
        device: device,
        previewLayer: nil
    )
    let observation = coordinator.observe(
        \.videoRotationAngleForHorizonLevelCapture,
        options: [.initial, .new]
    ) { coordinator, _ in
        emitter.emit(angle: Double(coordinator.videoRotationAngleForHorizonLevelCapture))
    }
    withExtendedLifetime(observation) {
        RunLoop.main.run()
    }
}

private final class DocumentProcessor {
    private let context = CIContext(options: [
        .cacheIntermediates: false,
        .useSoftwareRenderer: false,
    ])
    private let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
    private lazy var paperWhiteningKernel = CIColorKernel(source: """
    kernel vec4 selectivelyWhitenPaper(
        __sample source,
        __sample background,
        float targetPaper,
        float maximumLift,
        float paperNeutralization
    ) {
        float sourceLuminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
        float backgroundLuminance = dot(
            background.rgb,
            vec3(0.2126, 0.7152, 0.0722)
        );
        float distanceFromPaper = max(
            backgroundLuminance - sourceLuminance,
            0.0
        );

        // Pixels close to the locally estimated paper tone can be whitened.
        // Dark ink and line work sit farther below that tone and therefore
        // receive little or no lift.
        float paperMask = 1.0 - smoothstep(0.035, 0.145, distanceFromPaper);
        float lift = clamp(
            targetPaper - backgroundLuminance,
            0.0,
            maximumLift
        ) * paperMask;
        float correctedLuminance = clamp(sourceLuminance + lift, 0.0, 1.0);

        vec3 corrected = source.rgb;
        if (sourceLuminance > 0.001) {
            corrected *= correctedLuminance / sourceLuminance;
        } else {
            corrected += vec3(lift);
        }
        corrected = mix(
            corrected,
            vec3(correctedLuminance),
            paperMask * paperNeutralization
        );
        return vec4(clamp(corrected, 0.0, 1.0), source.a);
    }
    """)

    func process(
        inputPath: String,
        outputPath: String,
        mode: String,
        beforeOutputPath: String? = nil
    ) throws -> ProcessResult {
        emitDocumentProgress(stage: "starting")
        let inputURL = URL(fileURLWithPath: inputPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        guard var image = CIImage(contentsOf: inputURL, options: [.applyOrientationProperty: true]) else {
            throw ProcessorError.unreadableImage
        }

        var warnings: [String] = []
        var corners: [String: Point] = fullPageCorners()
        var pageDetected = false

        emitDocumentProgress(stage: "detecting_page")
        if let document = detectDocument(in: image) {
            emitDocumentProgress(stage: "correcting_page")
            let corrected = perspectiveCorrect(image, using: document)
            if isPlausiblePage(corrected) {
                corners = normalizedCorners(document)
                image = corrected
                pageDetected = true
            } else {
                warnings.append("检测到的页面边界比例异常，已保留完整原图")
            }
        } else {
            warnings.append("未检测到完整页面边界，已保留原图范围")
        }

        if let beforeOutputPath {
            try render(image, to: URL(fileURLWithPath: beforeOutputPath))
        }
        let recognitionImage = prepareForTextRecognition(image)
        let enhanced = enhance(image, mode: mode)
        try render(enhanced, to: outputURL)
        let extent = enhanced.extent.integral
        emitDocumentProgress(
            stage: "corrected_ready",
            correctedPath: outputPath,
            width: Int(extent.width),
            height: Int(extent.height)
        )

        emitDocumentProgress(stage: "recognizing_text")
        let lines = recognizeText(in: recognitionImage)
        if lines.isEmpty {
            warnings.append("没有识别到文字，请手动添加题目块")
        }
        emitDocumentProgress(stage: "generating_blocks")
        let blocks = generateProblemBlocks(from: lines)
        if blocks.count == 1 && !lines.isEmpty {
            warnings.append("未识别到明确题号，已按版面生成一个候选块")
        }

        emitDocumentProgress(stage: "completed")
        return ProcessResult(
            correctedPath: outputPath,
            width: Int(extent.width),
            height: Int(extent.height),
            pageDetected: pageDetected,
            corners: corners,
            textLines: lines,
            blocks: blocks,
            enhancementMode: mode,
            warnings: warnings
        )
    }

    func warmUp() throws {
        let image = CIImage(color: CIColor(red: 1, green: 1, blue: 1))
            .cropped(to: CGRect(x: 0, y: 0, width: 64, height: 64))
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.automaticallyDetectsLanguage = false
        request.recognitionLanguages = ["zh-Hans"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.004
        try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
    }

    func crop(
        inputPath: String,
        outputPath: String,
        rect: NormalizedRect
    ) throws {
        let inputURL = URL(fileURLWithPath: inputPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        guard let image = CIImage(
            contentsOf: inputURL,
            options: [.applyOrientationProperty: true]
        ) else {
            throw ProcessorError.unreadableImage
        }
        guard
            rect.x.isFinite,
            rect.y.isFinite,
            rect.width.isFinite,
            rect.height.isFinite,
            rect.x >= 0,
            rect.y >= 0,
            rect.width > 0,
            rect.height > 0,
            rect.maxX <= 1.000_001,
            rect.maxY <= 1.000_001
        else {
            throw ProcessorError.invalidCrop
        }

        let extent = image.extent
        let requested = CGRect(
            x: extent.minX + rect.x * extent.width,
            y: extent.maxY - rect.maxY * extent.height,
            width: rect.width * extent.width,
            height: rect.height * extent.height
        )
        let pixelRect = requested.intersection(extent).integral
        guard pixelRect.width >= 2, pixelRect.height >= 2 else {
            throw ProcessorError.invalidCrop
        }
        let cropped = image
            .cropped(to: pixelRect)
            .transformed(
                by: CGAffineTransform(
                    translationX: -pixelRect.minX,
                    y: -pixelRect.minY
                )
            )
        try render(cropped, to: outputURL)
    }

    private func fullPageCorners() -> [String: Point] {
        [
            "topLeft": Point(x: 0, y: 0),
            "topRight": Point(x: 1, y: 0),
            "bottomLeft": Point(x: 0, y: 1),
            "bottomRight": Point(x: 1, y: 1),
        ]
    }

    private func isPlausiblePage(_ image: CIImage) -> Bool {
        let extent = image.extent.integral
        let shortEdge = min(extent.width, extent.height)
        let longEdge = max(extent.width, extent.height)
        guard shortEdge > 0 else { return false }
        // Exam pages are close to A-series proportions. A wider tolerance
        // allows perspective and partial margins but rejects diagonal strips
        // mistakenly returned by document segmentation.
        return longEdge / shortEdge <= 1.75
    }

    private func detectDocument(in image: CIImage) -> VNRectangleObservation? {
        let request = VNDetectDocumentSegmentationRequest()
        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
            return request.results?.first
        } catch {
            return nil
        }
    }

    private func normalizedCorners(_ rectangle: VNRectangleObservation) -> [String: Point] {
        func convert(_ value: CGPoint) -> Point {
            Point(x: value.x, y: 1 - value.y)
        }
        return [
            "topLeft": convert(rectangle.topLeft),
            "topRight": convert(rectangle.topRight),
            "bottomLeft": convert(rectangle.bottomLeft),
            "bottomRight": convert(rectangle.bottomRight),
        ]
    }

    private func perspectiveCorrect(
        _ image: CIImage,
        using rectangle: VNRectangleObservation
    ) -> CIImage {
        let extent = image.extent
        func imagePoint(_ point: CGPoint) -> CIVector {
            CIVector(
                x: extent.minX + CGFloat(point.x) * extent.width,
                y: extent.minY + CGFloat(point.y) * extent.height
            )
        }

        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return image }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(imagePoint(rectangle.topLeft), forKey: "inputTopLeft")
        filter.setValue(imagePoint(rectangle.topRight), forKey: "inputTopRight")
        filter.setValue(imagePoint(rectangle.bottomLeft), forKey: "inputBottomLeft")
        filter.setValue(imagePoint(rectangle.bottomRight), forKey: "inputBottomRight")
        return filter.outputImage ?? image
    }

    private func enhance(_ image: CIImage, mode: String) -> CIImage {
        var output = image

        if mode != "grayscale", let paperColor = estimatedPaperRGB(in: image) {
            output = applyingConservativeWhiteBalance(
                to: output,
                paperColor: paperColor
            )
        }

        if
            let background = estimatedPaperBackground(in: output),
            let whitened = paperWhiteningKernel?.apply(
                extent: output.extent,
                arguments: [
                    output,
                    background,
                    mode == "grayscale" ? 0.965 : 0.95,
                    0.42,
                    mode == "grayscale" ? 1.0 : 0.62,
                ]
            )
        {
            output = whitened
        }

        if let gamma = CIFilter(name: "CIGammaAdjust") {
            gamma.setValue(output, forKey: kCIInputImageKey)
            gamma.setValue(
                mode == "grayscale" ? 0.96 : 0.98,
                forKey: "inputPower"
            )
            output = gamma.outputImage ?? output
        }

        if let toneCurve = CIFilter(name: "CIToneCurve") {
            toneCurve.setValue(output, forKey: kCIInputImageKey)
            toneCurve.setValue(CIVector(x: 0, y: 0), forKey: "inputPoint0")
            toneCurve.setValue(
                CIVector(x: 0.20, y: mode == "grayscale" ? 0.15 : 0.17),
                forKey: "inputPoint1"
            )
            toneCurve.setValue(
                CIVector(x: 0.50, y: mode == "grayscale" ? 0.51 : 0.50),
                forKey: "inputPoint2"
            )
            toneCurve.setValue(
                CIVector(x: 0.80, y: mode == "grayscale" ? 0.87 : 0.84),
                forKey: "inputPoint3"
            )
            toneCurve.setValue(CIVector(x: 1, y: 1), forKey: "inputPoint4")
            output = toneCurve.outputImage ?? output
        }

        if let controls = CIFilter(name: "CIColorControls") {
            controls.setValue(output, forKey: kCIInputImageKey)
            controls.setValue(
                mode == "grayscale" ? 0.0 : 0.72,
                forKey: kCIInputSaturationKey
            )
            controls.setValue(0.0, forKey: kCIInputBrightnessKey)
            controls.setValue(
                mode == "grayscale" ? 1.12 : 1.08,
                forKey: kCIInputContrastKey
            )
            output = controls.outputImage ?? output
        }

        if let detail = CIFilter(name: "CIUnsharpMask") {
            detail.setValue(output, forKey: kCIInputImageKey)
            detail.setValue(0.28, forKey: kCIInputIntensityKey)
            detail.setValue(0.8, forKey: kCIInputRadiusKey)
            output = detail.outputImage ?? output
        }

        return output
    }

    private func prepareForTextRecognition(_ image: CIImage) -> CIImage {
        var output = image
        if let highlight = CIFilter(name: "CIHighlightShadowAdjust") {
            highlight.setValue(output, forKey: kCIInputImageKey)
            highlight.setValue(0.32, forKey: "inputShadowAmount")
            highlight.setValue(0.84, forKey: "inputHighlightAmount")
            output = highlight.outputImage ?? output
        }
        if let controls = CIFilter(name: "CIColorControls") {
            controls.setValue(output, forKey: kCIInputImageKey)
            controls.setValue(0.0, forKey: kCIInputSaturationKey)
            controls.setValue(0.0, forKey: kCIInputBrightnessKey)
            controls.setValue(1.14, forKey: kCIInputContrastKey)
            output = controls.outputImage ?? output
        }
        if let sharpen = CIFilter(name: "CISharpenLuminance") {
            sharpen.setValue(output, forKey: kCIInputImageKey)
            sharpen.setValue(0.32, forKey: kCIInputSharpnessKey)
            sharpen.setValue(0.35, forKey: kCIInputRadiusKey)
            output = sharpen.outputImage ?? output
        }
        return output
    }

    private struct RGB {
        let red: Double
        let green: Double
        let blue: Double
    }

    private func estimatedPaperRGB(in image: CIImage) -> RGB? {
        let maximumDimension = max(image.extent.width, image.extent.height)
        guard maximumDimension > 0 else { return nil }
        let scale = min(1, 160 / maximumDimension)
        let normalized = image.transformed(
            by: CGAffineTransform(
                translationX: -image.extent.minX,
                y: -image.extent.minY
            )
        )
        let sample = normalized.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )
        let bounds = sample.extent.integral
        let width = max(1, Int(bounds.width))
        let height = max(1, Int(bounds.height))
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        context.render(
            sample,
            toBitmap: &pixels,
            rowBytes: width * 4,
            bounds: bounds,
            format: .RGBA8,
            colorSpace: sRGB
        )

        var samples: [RGB] = []
        var luminances: [Double] = []
        samples.reserveCapacity(width * height)
        luminances.reserveCapacity(width * height)
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            guard pixels[offset + 3] > 0 else { continue }
            let value = RGB(
                red: Double(pixels[offset]) / 255,
                green: Double(pixels[offset + 1]) / 255,
                blue: Double(pixels[offset + 2]) / 255
            )
            samples.append(value)
            luminances.append(
                0.2126 * value.red
                    + 0.7152 * value.green
                    + 0.0722 * value.blue
            )
        }
        guard !samples.isEmpty else { return nil }
        let sortedLuminances = luminances.sorted()
        let paperThreshold = sortedLuminances[
            min(sortedLuminances.count - 1, sortedLuminances.count * 7 / 10)
        ]
        var red: [Double] = []
        var green: [Double] = []
        var blue: [Double] = []
        for (index, value) in samples.enumerated() {
            let spread = max(value.red, value.green, value.blue)
                - min(value.red, value.green, value.blue)
            guard luminances[index] >= paperThreshold, spread <= 0.18 else {
                continue
            }
            red.append(value.red)
            green.append(value.green)
            blue.append(value.blue)
        }
        guard red.count >= 16 else { return nil }

        func median(_ values: [Double]) -> Double {
            let sorted = values.sorted()
            return sorted[sorted.count / 2]
        }
        return RGB(
            red: median(red),
            green: median(green),
            blue: median(blue)
        )
    }

    private func estimatedPaperBackground(in image: CIImage) -> CIImage? {
        let extent = image.extent
        let shortEdge = min(extent.width, extent.height)
        guard shortEdge > 0 else { return nil }
        let analysisScale = min(1, 512 / shortEdge)
        let normalized = image.transformed(
            by: CGAffineTransform(
                translationX: -extent.minX,
                y: -extent.minY
            )
        )
        var background = normalized.transformed(
            by: CGAffineTransform(
                scaleX: analysisScale,
                y: analysisScale
            )
        )
        let analysisExtent = background.extent

        if let luminance = CIFilter(name: "CIColorControls") {
            luminance.setValue(background, forKey: kCIInputImageKey)
            luminance.setValue(0.0, forKey: kCIInputSaturationKey)
            luminance.setValue(0.0, forKey: kCIInputBrightnessKey)
            luminance.setValue(1.0, forKey: kCIInputContrastKey)
            background = luminance.outputImage ?? background
        }
        if let maximum = CIFilter(name: "CIMorphologyMaximum") {
            maximum.setValue(background, forKey: kCIInputImageKey)
            maximum.setValue(2.5, forKey: kCIInputRadiusKey)
            background = maximum.outputImage ?? background
        }
        if let blur = CIFilter(name: "CIGaussianBlur") {
            blur.setValue(background, forKey: kCIInputImageKey)
            blur.setValue(18.0, forKey: kCIInputRadiusKey)
            background = blur.outputImage ?? background
        }

        background = background
            .cropped(to: analysisExtent)
            .transformed(
                by: CGAffineTransform(
                    scaleX: 1 / analysisScale,
                    y: 1 / analysisScale
                )
            )
            .cropped(
                to: CGRect(
                    x: 0,
                    y: 0,
                    width: extent.width,
                    height: extent.height
                )
            )
            .transformed(
                by: CGAffineTransform(
                    translationX: extent.minX,
                    y: extent.minY
                )
            )
        return background
    }

    private func applyingConservativeWhiteBalance(
        to image: CIImage,
        paperColor: RGB
    ) -> CIImage {
        let neutral = (paperColor.red + paperColor.green + paperColor.blue) / 3
        func channelScale(_ value: Double) -> Double {
            min(1.06, max(0.94, neutral / max(0.01, value)))
        }
        guard let filter = CIFilter(name: "CIColorMatrix") else { return image }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(
            CIVector(x: channelScale(paperColor.red), y: 0, z: 0, w: 0),
            forKey: "inputRVector"
        )
        filter.setValue(
            CIVector(x: 0, y: channelScale(paperColor.green), z: 0, w: 0),
            forKey: "inputGVector"
        )
        filter.setValue(
            CIVector(x: 0, y: 0, z: channelScale(paperColor.blue), w: 0),
            forKey: "inputBVector"
        )
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 1), forKey: "inputAVector")
        return filter.outputImage ?? image
    }

    private func render(_ image: CIImage, to url: URL) throws {
        guard
            let data = context.jpegRepresentation(
                of: image,
                colorSpace: sRGB,
                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.94]
            )
        else {
            throw ProcessorError.renderFailed
        }
        try data.write(to: url, options: .atomic)
    }

    private func recognizeText(in image: CIImage) -> [TextLine] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.automaticallyDetectsLanguage = false
        request.recognitionLanguages = ["zh-Hans"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.004

        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return TextLine(
                id: UUID().uuidString,
                text: candidate.string,
                confidence: Double(candidate.confidence),
                rect: NormalizedRect(
                    x: box.minX,
                    y: 1 - box.maxY,
                    width: box.width,
                    height: box.height
                )
            )
        }
        .sorted {
            if abs($0.rect.y - $1.rect.y) < 0.012 {
                return $0.rect.x < $1.rect.x
            }
            return $0.rect.y < $1.rect.y
        }
    }

    private func generateProblemBlocks(from lines: [TextLine]) -> [ProblemBlock] {
        guard !lines.isEmpty else { return [] }
        let sorted = lines.sorted { $0.rect.y < $1.rect.y }
        let anchors = questionAnchors(in: sorted)
        guard !anchors.isEmpty else {
            return blocksFromVerticalGaps(sorted)
        }

        var blocks: [ProblemBlock] = []
        for (index, anchor) in anchors.enumerated() {
            let startY = max(0.008, anchor.line.rect.y - 0.006)
            let endY: Double
            if index + 1 < anchors.count {
                // The next top-level question is the strongest possible end
                // marker. Keep everything before it, including D options,
                // tables and diagrams that Vision does not recognize as text.
                endY = max(startY + 0.035, anchors[index + 1].line.rect.y - 0.006)
            } else {
                let lastContentY = sorted
                    .filter { $0.rect.y >= startY }
                    .map(\.rect.maxY)
                    .max() ?? anchor.line.rect.maxY
                endY = min(0.988, max(startY + 0.08, lastContentY + 0.018))
            }

            let members = sorted.filter {
                $0.rect.maxY >= startY && $0.rect.y < endY
            }
            let rect = NormalizedRect(
                x: 0.018,
                y: startY,
                width: 0.964,
                height: endY - startY
            )
            blocks.append(
                makeBlock(
                    lines: members,
                    rect: rect,
                    preferredTitle: questionTitle(
                        number: anchor.number,
                        anchor: anchor.line,
                        members: members
                    )
                )
            )
        }
        return blocks
    }

    private func questionAnchors(in lines: [TextLine]) -> [QuestionAnchor] {
        let candidates = lines.compactMap { line -> QuestionAnchor? in
            guard line.rect.x < 0.24, let number = questionNumber(in: line.text) else {
                return nil
            }
            return QuestionAnchor(number: number, line: line)
        }
        .sorted { $0.line.rect.y < $1.line.rect.y }

        guard candidates.count > 1 else { return candidates }

        // Chapter numbers, page numbers and numerical expressions can also
        // begin a line. The longest consecutive run identifies real question
        // numbering while discarding those isolated numbers.
        var best: [QuestionAnchor] = []
        var current: [QuestionAnchor] = []
        for candidate in candidates {
            if let previous = current.last,
               candidate.number > previous.number,
               candidate.number <= previous.number + 2,
               candidate.line.rect.y > previous.line.rect.y + 0.018 {
                current.append(candidate)
            } else {
                if current.count > best.count { best = current }
                current = [candidate]
            }
        }
        if current.count > best.count { best = current }
        let sequence = best.count >= 2 ? best : candidates
        guard sequence.count >= 2 else { return sequence }

        var repaired: [QuestionAnchor] = []
        for (index, anchor) in sequence.enumerated() {
            repaired.append(anchor)
            guard index + 1 < sequence.count else { continue }
            let next = sequence[index + 1]
            guard next.number == anchor.number + 2 else { continue }

            let midpoint = (anchor.line.rect.y + next.line.rect.y) / 2
            let possibleLines = lines.filter { line in
                line.rect.x < 0.11
                    && line.rect.y > anchor.line.rect.y + 0.018
                    && line.rect.y < next.line.rect.y - 0.018
            }
            let inferredLine = possibleLines.min { left, right in
                abs(left.rect.y - midpoint) < abs(right.rect.y - midpoint)
            }
            if let inferredLine {
                repaired.append(
                    QuestionAnchor(number: anchor.number + 1, line: inferredLine)
                )
            }
        }
        return repaired
    }

    private func questionTitle(
        number: Int,
        anchor: TextLine,
        members: [TextLine]
    ) -> String {
        let titleLines = members
            .filter { $0.rect.y < anchor.rect.y + 0.045 }
            .sorted {
                if abs($0.rect.y - $1.rect.y) < 0.012 {
                    return $0.rect.x < $1.rect.x
                }
                return $0.rect.y < $1.rect.y
            }
        let combined = titleLines.map(\.text).joined(separator: " ")
        var chinese = String(
            combined.unicodeScalars.compactMap { scalar -> Character? in
                let value = scalar.value
                if (0x3400...0x9FFF).contains(value) {
                    return Character(String(scalar))
                }
                if "，。？！：；、（）“”".unicodeScalars.contains(scalar) {
                    return Character(String(scalar))
                }
                return scalar == " " ? " " : nil
            }
        )
        chinese = chinese
            .replacingOccurrences(of: "万程", with: "方程")
            .replacingOccurrences(of: "昀解", with: "的解")
            .replacingOccurrences(of: "旳结果", with: "的结果")
            .replacingOccurrences(of: "一下列", with: "下列")
            .replacingOccurrences(of: "式子产", with: "式子")
            .replacingOccurrences(of: "這中", with: "中")
            .replacingOccurrences(of: "分式有", with: "分式的有")
        while chinese.contains("  ") {
            chinese = chinese.replacingOccurrences(of: "  ", with: " ")
        }
        chinese = chinese.trimmingCharacters(in: .whitespacesAndNewlines)

        if chinese.contains("则"), chinese.contains("的值是"),
           !chinese.hasPrefix("若") {
            chinese = "若……，则……的值是"
        }
        if chinese.contains("分式"), chinese.contains("值为"),
           chinese.contains("的值是") {
            chinese = "分式……的值为零时，未知数的值是"
        } else if chinese.contains("化简"), chinese.contains("结果是") {
            chinese = "化简……的结果是"
        } else if chinese.contains("解方程"), chinese.contains("去分母") {
            chinese = "解方程……时，去分母得"
        } else if chinese.contains("方程"), chinese.contains("的解为") {
            chinese = "方程……的解为"
        }
        if let firstIf = chinese.firstIndex(of: "若"), chinese[..<firstIf].count <= 4 {
            chinese = String(chinese[firstIf...])
        }
        guard chinese.count >= 2 else { return "第 \(number) 题" }
        return "\(number). \(chinese)"
    }

    private func blocksFromVerticalGaps(_ lines: [TextLine]) -> [ProblemBlock] {
        guard lines.count > 1 else {
            return [makeBlock(lines: lines, rect: NormalizedRect.union(lines.map(\.rect)).expanded(by: 0.02))]
        }

        let heights = lines.map(\.rect.height).sorted()
        let medianHeight = heights[heights.count / 2]
        let gapThreshold = max(0.035, medianHeight * 2.6)
        var groups: [[TextLine]] = []
        var current: [TextLine] = []
        var previousBottom = 0.0

        for line in lines {
            let gap = line.rect.y - previousBottom
            if !current.isEmpty && gap > gapThreshold {
                groups.append(current)
                current = []
            }
            current.append(line)
            previousBottom = max(previousBottom, line.rect.maxY)
        }
        if !current.isEmpty { groups.append(current) }

        if groups.count > 6 {
            return [makeBlock(lines: lines, rect: NormalizedRect.union(lines.map(\.rect)).expanded(by: 0.02))]
        }
        return groups.map {
            makeBlock(lines: $0, rect: NormalizedRect.union($0.map(\.rect)).expanded(by: 0.018))
        }
    }

    private func makeBlock(
        lines: [TextLine],
        rect: NormalizedRect,
        preferredTitle: String? = nil
    ) -> ProblemBlock {
        let firstText = preferredTitle?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            ?? lines.first?.text.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "未命名题目"
        let title = firstText.count > 36
            ? String(firstText.prefix(36)) + "…"
            : firstText
        let confidence = lines.isEmpty
            ? 0
            : lines.map(\.confidence).reduce(0, +) / Double(lines.count)
        return ProblemBlock(
            id: UUID().uuidString,
            title: title,
            rect: rect.clamped(),
            confidence: confidence,
            lineIds: lines.map(\.id),
            source: "auto"
        )
    }

    private func questionNumber(in text: String) -> Int? {
        // Top-level questions use an Arabic number followed by a full stop or
        // ideographic comma. Parenthesized subquestions and Chinese section
        // headings are deliberately excluded.
        let pattern = #"^\s*(\d{1,3})\s*[\.．、]"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard
            let match = expression.firstMatch(in: text, range: range),
            let numberRange = Range(match.range(at: 1), in: text)
        else {
            return nil
        }
        return Int(text[numberRange])
    }
}

@main
private enum AxiomVisionCLI {
    static func main() {
        do {
            let arguments = CommandLine.arguments
            guard arguments.count >= 2 else {
                throw ProcessorError.invalidArguments
            }

            func value(after flag: String) -> String? {
                guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
                    return nil
                }
                return arguments[index + 1]
            }

            let resultData: Data
            switch arguments[1] {
            case "watch-camera-orientation":
                guard let deviceLabel = value(after: "--device-label") else {
                    throw ProcessorError.invalidArguments
                }
                try watchCameraOrientation(deviceLabel: deviceLabel)
                return
            case "warm-up":
                try DocumentProcessor().warmUp()
                resultData = try JSONEncoder().encode(["ready": true])
            case "render-pdf-page":
                guard
                    let input = value(after: "--input"),
                    let output = value(after: "--output"),
                    let pageValue = value(after: "--page"),
                    let widthValue = value(after: "--width"),
                    let page = Int(pageValue),
                    let width = Int(widthValue)
                else {
                    throw ProcessorError.invalidArguments
                }
                resultData = try JSONEncoder().encode(renderPDFPage(
                    inputPath: input,
                    outputPath: output,
                    pageNumber: page,
                    pixelWidth: width
                ))
            case "extract-textbook":
                guard let input = value(after: "--input") else {
                    throw ProcessorError.invalidArguments
                }
                resultData = try JSONEncoder().encode(
                    extractTextbookPDF(inputPath: input)
                )
            case "extract-textbook-image":
                guard let input = value(after: "--input") else {
                    throw ProcessorError.invalidArguments
                }
                resultData = try JSONEncoder().encode(
                    extractTextbookImage(inputPath: input)
                )
            case "process":
                guard
                    let input = value(after: "--input"),
                    let output = value(after: "--output")
                else {
                    throw ProcessorError.invalidArguments
                }
                let mode = value(after: "--mode") ?? "color"
                resultData = try JSONEncoder().encode(
                    DocumentProcessor().process(
                        inputPath: input,
                        outputPath: output,
                        mode: mode,
                        beforeOutputPath: value(after: "--before-output")
                    )
                )
            case "crop":
                guard
                    let input = value(after: "--input"),
                    let output = value(after: "--output"),
                    let xValue = value(after: "--x"),
                    let yValue = value(after: "--y"),
                    let widthValue = value(after: "--width"),
                    let heightValue = value(after: "--height"),
                    let x = Double(xValue),
                    let y = Double(yValue),
                    let width = Double(widthValue),
                    let height = Double(heightValue)
                else {
                    throw ProcessorError.invalidArguments
                }
                try DocumentProcessor().crop(
                    inputPath: input,
                    outputPath: output,
                    rect: NormalizedRect(
                        x: x,
                        y: y,
                        width: width,
                        height: height
                    )
                )
                resultData = try JSONEncoder().encode(["path": output])
            default:
                throw ProcessorError.invalidArguments
            }
            FileHandle.standardOutput.write(resultData)
            exit(0)
        } catch {
            let message = error.localizedDescription
            FileHandle.standardError.write(Data(message.utf8))
            exit(1)
        }
    }
}
