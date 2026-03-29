import { NextRequest, NextResponse } from 'next/server';
import { parseExcelBuffer } from '@/lib/excelParser';
import OfficeCrypto from 'officecrypto-tool';

/** 엑셀 파일 업로드 + 파싱 API */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const password = formData.get('password') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: '파일이 없습니다.' },
        { status: 400 }
      );
    }

    /** 파일 확장자 검증 */
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xls') && !fileName.endsWith('.xlsx')) {
      return NextResponse.json(
        { error: '.xls 또는 .xlsx 파일만 업로드 가능합니다.' },
        { status: 400 }
      );
    }

    /** 파일 크기 제한 (50MB) */
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '파일 크기는 50MB를 초과할 수 없습니다.' },
        { status: 413 }
      );
    }

    /** 파일 버퍼 읽기 */
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const excelPassword = password || process.env.EXCEL_DEFAULT_PASSWORD || '';

    /** 암호화 여부 확인 후 복호화 */
    let decryptedBuffer: Buffer;
    const isEncrypted = await OfficeCrypto.isEncrypted(rawBuffer);

    if (isEncrypted) {
      if (!excelPassword) {
        return NextResponse.json(
          { error: '암호화된 파일입니다. 비밀번호를 입력해주세요.' },
          { status: 401 }
        );
      }
      try {
        decryptedBuffer = await OfficeCrypto.decrypt(rawBuffer, { password: excelPassword });
      } catch {
        return NextResponse.json(
          { error: '엑셀 비밀번호가 올바르지 않습니다. 비밀번호를 확인해주세요.' },
          { status: 401 }
        );
      }
    } else {
      decryptedBuffer = rawBuffer;
    }

    /** 복호화된 엑셀 파싱 */
    const parsedData = parseExcelBuffer(decryptedBuffer);
    parsedData.fileName = file.name;

    return NextResponse.json({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    console.error('[upload] parse error:', error);
    return NextResponse.json(
      { error: '파일 파싱 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
