var BufferedFileWriter = function() {
	
	var me = Class.create();

	var __base64DefaultOptions = {
			alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
			padding: '=',
			paddingOptional: false,
			foreignCharacters: false,
			maxLineLength: null,
			lineSeparator: '\r\n'
	};

	var __buffer = null;
	var __bufferSize = 0;
	var __inputBytes = null;

	var __fileName = null;
	var __totalSizeBytes = 0;
	var __mimeType = null;
	var __sysAttachment = null;
	var __docPosition = 0;
	var __startTime = 0;
	var __endTime = 0;

	var __chunk;

	var init = function() {
		__buffer = [];
		__bufferSize = 3000; 
		__inputBytes = [];
		__startTime = new GlideDateTime().getNumericValue();
	};

	me.open = function(fileName, table, tableSysId, contentType) {
		
		if (!fileName) return null;

		var extension = __getExtensionFromFileName(fileName);
		__mimeType = contentType || __getMimeTypeFromExtension(extension);
		__fileName = fileName;

		var grAttachment = new GlideRecord('sys_attachment');
		grAttachment.initialize();
		grAttachment.size_bytes = 0;
		grAttachment.compressed = false;
		grAttachment.content_type = __mimeType;
		grAttachment.file_name = __fileName;
		grAttachment.table_name = table;
		grAttachment.table_sys_id = tableSysId;
		__sysAttachment = grAttachment.insert();
		
		return __sysAttachment;
	};

	me.appendBytes = function(bytes) {
		__inputBytes = bytes;
		__transformByteArrayToUnsignedBytes();
		__writeBytes();
	};

	me.appendString = function(string, optCharset) {
		// Charset: see Java charsets
		var stringBytes = new Packages.java.lang.String(string, optCharset || "Windows-1252");
		me.appendBytes(stringBytes.getBytes());
	};

	me.appendFile = function(attachmentSysId) {
		var byteOutputStream = new Packages.java.io.ByteArrayOutputStream();
		var attInputStream = new GlideSysAttachmentInputStream(attachmentSysId);
		attInputStream.writeTo(byteOutputStream, 0, 0);
		me.appendBytes(byteOutputStream.toByteArray());
	};

	me.close = function() {
		// Write remaining chunk data
		__writeChunk(true);

		// Update attachment record with length of file
		var grAttachment = new GlideRecord('sys_attachment');
		grAttachment.get(__sysAttachment);
		grAttachment.size_bytes = __totalSizeBytes;
		__sysAttachment = grAttachment.update();

		__endTime = new GlideDateTime().getNumericValue();

		gs.info('BufferedFileWriter created file:\n ' + JSON.stringify({
			__mimeType: __mimeType,
			__fileName: __fileName,
			__sysAttachment: __sysAttachment,
			totalTime: (__endTime - __startTime) + 'ms'
		}));

		return __sysAttachment;
	};

	me.getBase64DefaultOptions = function() {
		return __base64DefaultOptions;
	};

	me.setBase64DefaultOptions = function(base64DefaultOptions) {
		__base64DefaultOptions = base64DefaultOptions;
	};

	__getExtensionFromFileName = function(fileName) {
		return fileName.split('.')[fileName.split('.').length - 1];
	};

	__writeBytes = function() {
		var offset = 0;
		while (offset < __inputBytes.length) {
			var chunkSize = Math.min(__bufferSize, __inputBytes.length - offset);
			__chunk = __inputBytes.slice(offset, (offset + chunkSize));
			__writeChunk(false);
			offset += chunkSize;
		}
	};

	__writeChunk = function(isFileEnd) {
		
		__buffer = __buffer.concat(__chunk);

		while (__buffer.length >= __bufferSize) {
			var toWrite = __buffer.slice(0, __bufferSize);
			__buffer = __buffer.slice(__bufferSize);
			__writeSysAttachmentDoc(toWrite);
		}

		if (isFileEnd) {
			__writeSysAttachmentDoc(__buffer);
		}
	};

	__writeSysAttachmentDoc = function(toWrite) {
		var b64 = __getChunkBase64(toWrite);
		var grAttachmentDoc = new GlideRecord('sys_attachment_doc');
		grAttachmentDoc.initialize();
		grAttachmentDoc.data = b64;
		grAttachmentDoc.length = toWrite.length;
		grAttachmentDoc.sys_attachment = __sysAttachment;
		grAttachmentDoc.position = __docPosition;
		grAttachmentDoc.insert();

		__docPosition++;

		__totalSizeBytes += toWrite.length;
	};

	__transformByteArrayToUnsignedBytes = function() {
		
		var temp = [];
		for (var i = 0; i < __inputBytes.length; i++) {
			temp.push(__inputBytes[i]);
		}
		for (i = 0; i < temp.length; i++) {
			if (temp[i] < 0) temp[i] += 256;
		}
		__inputBytes = temp; 
	};

	__getChunkBase64 = function(bytes) {

		var alphabet = __base64DefaultOptions.alphabet;
		var padding = __base64DefaultOptions.padding;
		var paddingOptional = __base64DefaultOptions.paddingOptional;
		var maxLineLength = __base64DefaultOptions.maxLineLength;
		var lineSeparator = __base64DefaultOptions.lineSeparator;

		var paddingCharacter = !paddingOptional && padding ? padding : '';

		var string = '';
		var byte1, byte2, byte3;
		var octet1, octet2, octet3, octet4;

		var i;
		for (i = 0; i < bytes.length; i += 3) {
			byte1 = bytes[i];
			if (i + 1 < bytes.length) {
				byte2 = bytes[i + 1];
			} else {
				byte2 = null;
			}
			if (i + 2 < bytes.length) {
				byte3 = bytes[i + 2];
			} else {
				byte3 = null;
			}

			octet1 = byte1 >> 2;
			octet2 = ((byte1 & 3) << 4) | (byte2 >> 4);
			octet3 = ((byte2 & 15) << 2) | (byte3 >> 6);
			octet4 = byte3 & 63;

			string +=
			alphabet[octet1] +
			alphabet[octet2] +
			(isNaN(byte2) == false ? alphabet[octet3] : paddingCharacter) +
			(isNaN(byte3) == false ? alphabet[octet4] : paddingCharacter);
		}
		
		if (maxLineLength) {
			var limitedString = '';
			for (i = 0; i < string.length; i += maxLineLength) {
				var notEmpty = limitedString !== '';
				limitedString += notEmpty ? lineSeparator : '';
				limitedString += string.substr(i, maxLineLength);
			}
			string = limitedString;
		}

		return string;
	};

	var __getMimeTypeFromExtension = function(extension) {
		extension = extension || 'txt';

		var mimeTypes = {
			// Images
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',

			// Documents
			pdf: 'application/pdf',
			doc: 'application/msword',
			docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

			xls: 'application/vnd.ms-excel',
			xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			ppt: 'application/vnd.ms-powerpoint',
			pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

			// Plain text
			txt: 'text/plain',

			// Archives
			zip: 'application/zip',
			rar: 'application/x-rar-compressed',
			tar: 'application/x-tar',
			gz: 'application/gzip',

			// Audio
			mp3: 'audio/mpeg',
			wav: 'audio/wav',
			ogg: 'audio/ogg',
			aac: 'audio/aac',

			// Video
			mp4: 'video/mp4',
			mov: 'video/quicktime',
			avi: 'video/x-msvideo',
			webm: 'video/webm',

			// Other
			json: 'application/json',
			xml: 'application/xml',
			css: 'text/css',
			js: 'application/javascript',
			html: 'text/html',
			csv: 'text/csv'
		};
		
		return mimeTypes[extension.toLowerCase()] || null;
	};

	init();

	return me;
};

BufferedFileWriter.prototype = {
    initialize: function() {
    },
    type: 'BufferedFileWriter'
};
