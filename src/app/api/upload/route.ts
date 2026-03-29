import { NextRequest, NextResponse } from 'next/server';
import { parseExcelBuffer } from '@/lib/excelParser';

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

    /** 파일 버퍼 읽기 */
    const buffer = await file.arrayBuffer();

    /** 엑셀 파싱 (암호화 해제 포함) */
    const excelPassword = password || process.env.EXCEL_DEFAULT_PASSWORD || '';
    const parsedData = parseExcelBuffer(buffer, excelPassword);
    parsedData.fileName = file.name;

    return NextResponse.json({
      success: true,
      data: parsedData,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '파일 파싱 중 오류가 발생했습니다.';

    /** 비밀번호 오류 감지 */
    if (message.includes('encrypt') || message.includes('password') || message.includes('Password')) {
      return NextResponse.json(
        { error: '엑셀 비밀번호가 올바르지 않습니다. 비밀번호를 확인해주세요.' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
