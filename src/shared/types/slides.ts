export interface SlideIndexEntry {
  courseCode: string;
  courseName: string;
  lectureNum: string;
  slideNum: string;
  slideTitle: string;
  moocsUrl: string;
  presentationId?: string;
  driveFileId?: string;
  text: string;
  keywords: string[];
}

export interface SlidesIndex {
  version: number;
  generatedAt: string;
  entries: SlideIndexEntry[];
}

export interface SlideMatch {
  courseCode: string;
  courseName: string;
  slideTitle: string;
  moocsUrl: string;
  text: string;
  confidence: number;
}
