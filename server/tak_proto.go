package main

import (
	"encoding/binary"
	"math"
	"regexp"
)

// TAK protobuf codec — hand-coded parser/encoder for the TAK wire format.
// Avoids external proto dependency since the schema is small and stable.
//
// TAK wire format:
//   3-byte magic: 0xBF 0x01 0xBF
//   followed by a protobuf-encoded TakMessage
//
// Protobuf field numbers:
//   TakMessage:  field 2 = CotEvent (embedded message)
//   CotEvent:    field 1 = type (string), field 4 = how (string),
//                field 5 = uid (string), field 6 = sendTime (uint64),
//                field 10 = lat (double), field 11 = lon (double),
//                field 12 = hae (double), field 13 = ce (double),
//                field 14 = le (double), field 15 = Detail (message)
//   Detail:      field 1 = xmlDetail (string), field 2 = Contact (message),
//                field 3 = Group (message)
//   Contact:     field 4 = callsign (string)
//   Group:       field 1 = name (string), field 2 = role (string)

// TakCotEvent is the decoded CoT event from TAK protobuf wire format.
type TakCotEvent struct {
	UID      string
	Type     string
	Callsign string
	How      string
	Lat      float64
	Lon      float64
	Hae      float64
	Ce       float64
	Le       float64
	Team     string
	Role     string
}

var takMagic = []byte{0xBF, 0x01, 0xBF}

// droidRegex extracts callsign from xmlDetail Droid="..." attribute.
var droidRegex = regexp.MustCompile(`Droid="([^"]+)"`)

// DecodeTakProto decodes a TAK protobuf wire message into a TakCotEvent.
// Returns nil if the buffer is too short or not a valid TAK message.
func DecodeTakProto(buf []byte) *TakCotEvent {
	if len(buf) < 3 || buf[0] != 0xBF || buf[1] != 0x01 || buf[2] != 0xBF {
		return nil
	}
	// Parse TakMessage envelope — extract CotEvent from field 2
	cotBytes := protoExtractMessage(buf[3:], 2)
	if cotBytes == nil {
		return nil
	}
	return decodeCotEvent(cotBytes)
}

func decodeCotEvent(buf []byte) *TakCotEvent {
	ev := &TakCotEvent{}
	pos := 0
	for pos < len(buf) {
		tag, n := decodeVarint(buf[pos:])
		if n == 0 {
			break
		}
		pos += n
		fieldNum := tag >> 3
		wireType := tag & 0x07

		switch wireType {
		case 0: // varint
			val, n := decodeVarint(buf[pos:])
			if n == 0 {
				return ev
			}
			pos += n
			if fieldNum == 6 { // sendTime (uint64, not used in output but consumed)
				_ = val
			}
		case 1: // 64-bit (double)
			if pos+8 > len(buf) {
				return ev
			}
			bits := binary.LittleEndian.Uint64(buf[pos : pos+8])
			val := math.Float64frombits(bits)
			pos += 8
			switch fieldNum {
			case 10:
				ev.Lat = val
			case 11:
				ev.Lon = val
			case 12:
				ev.Hae = val
			case 13:
				ev.Ce = val
			case 14:
				ev.Le = val
			}
		case 2: // length-delimited (string / embedded message)
			length, n := decodeVarint(buf[pos:])
			if n == 0 {
				return ev
			}
			pos += n
			if pos+int(length) > len(buf) {
				return ev
			}
			data := buf[pos : pos+int(length)]
			pos += int(length)
			switch fieldNum {
			case 1: // type
				ev.Type = string(data)
			case 4: // how
				ev.How = string(data)
			case 5: // uid
				ev.UID = string(data)
			case 15: // Detail message
				decodeDetail(data, ev)
			}
		case 5: // 32-bit
			if pos+4 > len(buf) {
				return ev
			}
			pos += 4
		default:
			return ev
		}
	}
	return ev
}

func decodeDetail(buf []byte, ev *TakCotEvent) {
	pos := 0
	for pos < len(buf) {
		tag, n := decodeVarint(buf[pos:])
		if n == 0 {
			break
		}
		pos += n
		fieldNum := tag >> 3
		wireType := tag & 0x07

		switch wireType {
		case 0:
			_, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
		case 1:
			if pos+8 > len(buf) {
				return
			}
			pos += 8
		case 2:
			length, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
			if pos+int(length) > len(buf) {
				return
			}
			data := buf[pos : pos+int(length)]
			pos += int(length)
			switch fieldNum {
			case 1: // xmlDetail — try to extract callsign from Droid="..."
				if ev.Callsign == "" {
					if m := droidRegex.FindSubmatch(data); len(m) > 1 {
						ev.Callsign = string(m[1])
					}
				}
			case 2: // Contact message
				decodeContact(data, ev)
			case 3: // Group message
				decodeGroup(data, ev)
			}
		case 5:
			if pos+4 > len(buf) {
				return
			}
			pos += 4
		default:
			return
		}
	}
}

func decodeContact(buf []byte, ev *TakCotEvent) {
	pos := 0
	for pos < len(buf) {
		tag, n := decodeVarint(buf[pos:])
		if n == 0 {
			break
		}
		pos += n
		fieldNum := tag >> 3
		wireType := tag & 0x07

		switch wireType {
		case 0:
			_, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
		case 1:
			if pos+8 > len(buf) {
				return
			}
			pos += 8
		case 2:
			length, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
			if pos+int(length) > len(buf) {
				return
			}
			data := buf[pos : pos+int(length)]
			pos += int(length)
			if fieldNum == 4 { // callsign
				ev.Callsign = string(data)
			}
		case 5:
			if pos+4 > len(buf) {
				return
			}
			pos += 4
		default:
			return
		}
	}
}

func decodeGroup(buf []byte, ev *TakCotEvent) {
	pos := 0
	for pos < len(buf) {
		tag, n := decodeVarint(buf[pos:])
		if n == 0 {
			break
		}
		pos += n
		fieldNum := tag >> 3
		wireType := tag & 0x07

		switch wireType {
		case 0:
			_, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
		case 1:
			if pos+8 > len(buf) {
				return
			}
			pos += 8
		case 2:
			length, n := decodeVarint(buf[pos:])
			if n == 0 {
				return
			}
			pos += n
			if pos+int(length) > len(buf) {
				return
			}
			data := buf[pos : pos+int(length)]
			pos += int(length)
			switch fieldNum {
			case 1: // name (team color)
				ev.Team = string(data)
			case 2: // role
				ev.Role = string(data)
			}
		case 5:
			if pos+4 > len(buf) {
				return
			}
			pos += 4
		default:
			return
		}
	}
}

// EncodeTakProto encodes a TakCotEvent into the TAK protobuf wire format
// (3-byte magic + TakMessage protobuf).
func EncodeTakProto(cot *TakCotEvent) []byte {
	// Build CotEvent protobuf
	var cotBuf []byte

	// field 1: type (string)
	if cot.Type != "" {
		cotBuf = appendProtoString(cotBuf, 1, cot.Type)
	}
	// field 4: how (string)
	if cot.How != "" {
		cotBuf = appendProtoString(cotBuf, 4, cot.How)
	}
	// field 5: uid (string)
	if cot.UID != "" {
		cotBuf = appendProtoString(cotBuf, 5, cot.UID)
	}
	// field 10: lat (double)
	cotBuf = appendProtoDouble(cotBuf, 10, cot.Lat)
	// field 11: lon (double)
	cotBuf = appendProtoDouble(cotBuf, 11, cot.Lon)
	// field 12: hae (double)
	cotBuf = appendProtoDouble(cotBuf, 12, cot.Hae)
	// field 13: ce (double)
	cotBuf = appendProtoDouble(cotBuf, 13, cot.Ce)
	// field 14: le (double)
	cotBuf = appendProtoDouble(cotBuf, 14, cot.Le)

	// Build Detail message
	var detailBuf []byte
	// Contact sub-message (field 2 of Detail)
	if cot.Callsign != "" {
		contactBuf := appendProtoString(nil, 4, cot.Callsign)
		detailBuf = appendProtoBytes(detailBuf, 2, contactBuf)
	}
	// Group sub-message (field 3 of Detail)
	if cot.Team != "" || cot.Role != "" {
		var groupBuf []byte
		if cot.Team != "" {
			groupBuf = appendProtoString(groupBuf, 1, cot.Team)
		}
		if cot.Role != "" {
			groupBuf = appendProtoString(groupBuf, 2, cot.Role)
		}
		detailBuf = appendProtoBytes(detailBuf, 3, groupBuf)
	}
	// field 15: Detail (message)
	if len(detailBuf) > 0 {
		cotBuf = appendProtoBytes(cotBuf, 15, detailBuf)
	}

	// Wrap CotEvent in TakMessage field 2
	takBuf := appendProtoBytes(nil, 2, cotBuf)

	// Prepend magic header
	out := make([]byte, 0, 3+len(takBuf))
	out = append(out, takMagic...)
	out = append(out, takBuf...)
	return out
}

// --- Protobuf encoding helpers ---

func appendProtoString(buf []byte, fieldNum uint64, s string) []byte {
	return appendProtoBytes(buf, fieldNum, []byte(s))
}

func appendProtoBytes(buf []byte, fieldNum uint64, data []byte) []byte {
	tag := (fieldNum << 3) | 2 // wire type 2 = length-delimited
	buf = appendVarint(buf, tag)
	buf = appendVarint(buf, uint64(len(data)))
	buf = append(buf, data...)
	return buf
}

func appendProtoDouble(buf []byte, fieldNum uint64, val float64) []byte {
	tag := (fieldNum << 3) | 1 // wire type 1 = 64-bit
	buf = appendVarint(buf, tag)
	var tmp [8]byte
	binary.LittleEndian.PutUint64(tmp[:], math.Float64bits(val))
	buf = append(buf, tmp[:]...)
	return buf
}

func appendVarint(buf []byte, val uint64) []byte {
	for val >= 0x80 {
		buf = append(buf, byte(val)|0x80)
		val >>= 7
	}
	buf = append(buf, byte(val))
	return buf
}

// --- Protobuf decoding helpers ---

func decodeVarint(buf []byte) (uint64, int) {
	var val uint64
	var shift uint
	for i, b := range buf {
		if i >= 10 { // varint too long
			return 0, 0
		}
		val |= uint64(b&0x7F) << shift
		if b < 0x80 {
			return val, i + 1
		}
		shift += 7
	}
	return 0, 0
}

// protoExtractMessage extracts the first occurrence of a length-delimited
// field with the given field number from a protobuf buffer.
func protoExtractMessage(buf []byte, targetField uint64) []byte {
	pos := 0
	for pos < len(buf) {
		tag, n := decodeVarint(buf[pos:])
		if n == 0 {
			break
		}
		pos += n
		fieldNum := tag >> 3
		wireType := tag & 0x07

		switch wireType {
		case 0: // varint
			_, n := decodeVarint(buf[pos:])
			if n == 0 {
				return nil
			}
			pos += n
		case 1: // 64-bit
			if pos+8 > len(buf) {
				return nil
			}
			pos += 8
		case 2: // length-delimited
			length, n := decodeVarint(buf[pos:])
			if n == 0 {
				return nil
			}
			pos += n
			if pos+int(length) > len(buf) {
				return nil
			}
			if fieldNum == targetField {
				return buf[pos : pos+int(length)]
			}
			pos += int(length)
		case 5: // 32-bit
			if pos+4 > len(buf) {
				return nil
			}
			pos += 4
		default:
			return nil
		}
	}
	return nil
}
